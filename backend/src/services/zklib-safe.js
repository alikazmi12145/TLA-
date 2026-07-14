/**
 * Defensive wrapper / patcher for node-zklib.
 *
 * node-zklib (as of the version pinned in package.json) has two production
 * defects that surface as random crashes on a long-running VPS:
 *
 *   1) `zklibtcp.js#readWithBuffer` continues executing after `requestData`
 *      rejects — so the next line does `reply.subarray(0, 16)` on `null`
 *      and throws `TypeError: Cannot read properties of null (reading
 *      'subarray')`. Because the throw happens inside an `async` Promise
 *      executor after an `await`, it becomes an unhandledRejection that
 *      can kill PM2 workers.
 *
 *   2) `zklibtcp.js#requestData` attaches a `'data'` listener on the socket
 *      and only removes it on the SUCCESS path (inside `internalCallback`).
 *      Every timeout / error path leaks that listener AND its captured
 *      `replyBuffer` closure — that is the `MaxListenersExceededWarning`
 *      and the slow VPS memory growth (each failed `getUsers` /
 *      `getAttendances` leaks a listener + a Buffer chain).
 *
 * We fix both by monkey-patching the specific ZKLibTCP instance we build
 * for each device (never `node_modules` on disk). The patches are 100 %
 * behaviour-compatible on the success path; on the failure path they
 * clean up listeners and translate the null-reply case into a normal
 * rejection instead of a hard crash.
 */

// eslint-disable-next-line import/no-unresolved
const { COMMANDS } = require('node-zklib/constants');
// eslint-disable-next-line import/no-unresolved
const {
  createTCPHeader,
  decodeTCPHeader,
  checkNotEventTCP,
} = require('node-zklib/utils');

const PATCHED = Symbol.for('tla.zklib.patched');

/**
 * Patch a live ZKLib instance so its TCP transport is memory-safe.
 * Safe to call multiple times — no-ops after the first application.
 */
function patchZKLibInstance(zk) {
  if (!zk || !zk.zklibTcp || zk.zklibTcp[PATCHED]) return zk;
  const tcp = zk.zklibTcp;
  tcp[PATCHED] = true;

  // ---- replacement for requestData: always removes the data listener ----
  tcp.requestData = function requestDataSafe(msg) {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.destroyed) {
        reject(new Error('SOCKET_NOT_CONNECTED'));
        return;
      }

      let replyBuffer = Buffer.from([]);
      let timer = null;
      let settled = false;

      // ------------------------------------------------------------------
      // Cleanup is the single place where every listener + timer we
      // attached below is released. Called from every completion path,
      // including the new socket 'close' / 'error' paths — without those
      // hooks a socket that died between packets would strand the 'data'
      // listener and its `replyBuffer` closure forever (memory leak +
      // MaxListenersExceededWarning after a few dozen failures).
      // ------------------------------------------------------------------
      const cleanup = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        try { socket.removeListener('data', handleOnData); } catch { /* ignore */ }
        try { socket.removeListener('close', onSocketClose); } catch { /* ignore */ }
        try { socket.removeListener('error', onSocketError); } catch { /* ignore */ }
        // Drop the growing buffer reference so GC can reclaim its chunks
        // immediately, even if the caller retains the returned Promise.
        replyBuffer = null;
      };
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err); else resolve(val);
      };

      const finalizeSoon = () => {
        // Small settle delay so the last chunk of CMD_DATA can arrive.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => done(null, replyBuffer), 1000);
      };

      function handleOnData(data) {
        try {
          if (!Buffer.isBuffer(data) || data.length === 0) return;
          replyBuffer = Buffer.concat([replyBuffer, data]);
          if (checkNotEventTCP(data)) return;
          if (replyBuffer.length < 16) return;

          if (timer) { clearTimeout(timer); timer = null; }
          const header = decodeTCPHeader(replyBuffer.subarray(0, 16));
          if (header.commandId === COMMANDS.CMD_DATA) {
            finalizeSoon();
          } else {
            timer = setTimeout(
              () => done(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA')),
              this.timeout || 5000
            );
            const packetLength = data.readUIntLE(4, 2);
            if (packetLength > 8) done(null, data);
          }
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)));
        }
      }

      // Socket-level failure paths: if the underlying TCP socket dies
      // between packets, node-zklib's internal state never resolves the
      // request. Reject explicitly so `exec()` tears down cleanly and
      // GC can free the buffered reply.
      const onSocketClose = () => done(new Error('SOCKET_CLOSED_DURING_REQUEST'));
      const onSocketError = (err) => done(err instanceof Error ? err : new Error(String(err)));

      socket.on('data', handleOnData);
      socket.once('close', onSocketClose);
      socket.once('error', onSocketError);

      socket.write(msg, null, (err) => {
        if (err) { done(err); return; }
        // Clear any prior timer before installing the response deadline —
        // otherwise finalizeSoon() and this callback can both hold a
        // pending timer for the same request.
        if (timer) { clearTimeout(timer); timer = null; }
        timer = setTimeout(
          () => done(new Error('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA')),
          this.timeout || 5000
        );
      });
    });
  };

  // ---- guard readWithBuffer against null / short reply from requestData ----
  const originalReadWithBuffer = tcp.readWithBuffer.bind(tcp);
  tcp.readWithBuffer = async function readWithBufferSafe(reqData, cb = null) {
    // We call the original implementation but pre-emptively verify the
    // socket state — the original has a code path where it rejects and
    // then continues to `reply.subarray(...)` on `null`. That path only
    // triggers when `requestData` rejects, so we detect obvious dead-socket
    // conditions first (cheapest fix), then still wrap the call so any
    // synchronous TypeError becomes a normal rejection.
    if (!this.socket || this.socket.destroyed) {
      throw new Error('SOCKET_NOT_CONNECTED');
    }
    try {
      const result = await originalReadWithBuffer(reqData, cb);
      return result;
    } catch (err) {
      // Normalise the node-zklib "subarray of null" TypeError so callers
      // see a clean, retryable message rather than a crash-shaped error.
      if (
        err &&
        err.message &&
        err.message.includes("reading 'subarray'")
      ) {
        throw new Error('DEVICE_RETURNED_INVALID_PACKET');
      }
      throw err;
    }
  };

  // Prevent EventEmitter warnings on the underlying socket. node-zklib's
  // getUsers/getAttendance internally attach several one-shot listeners on
  // the same socket during a single request; the default limit of 10 is
  // easy to hit on slow devices. We also see occasional bursts to ~50+
  // listeners during a reconnect (the old socket's listeners haven't been
  // GC'd yet when the new one is created), so we set the cap to 0 —
  // effectively "unlimited". This is safe because `cleanup()` above
  // removes every per-request listener on completion; the cap only
  // controls the EventEmitter warning threshold, not real memory use.
  const originalCreateSocket = tcp.createSocket.bind(tcp);
  tcp.createSocket = async function createSocketSafe(cbError, cbClose) {
    const result = await originalCreateSocket(cbError, cbClose);
    if (this.socket && typeof this.socket.setMaxListeners === 'function') {
      this.socket.setMaxListeners(0);
    }
    return result;
  };

  return zk;
}

module.exports = { patchZKLibInstance };
