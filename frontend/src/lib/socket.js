/**
 * Realtime socket singleton (browser).
 *
 * One socket per browser tab, regardless of how many components import
 * `getSocket()`. Connects lazily on first call; disconnected explicitly
 * on logout via `disconnectSocket()`.
 *
 * Backend events (see backend/src/services/realtime.service.js):
 *   device-online, device-offline, device-reconnected,
 *   attendance-import-started, attendance-import-finished,
 *   attendance-import-failed, attendance-created.
 */
import { io } from 'socket.io-client';
import { store } from '../app/store';

// Resolve the socket.io endpoint.
//
//   - In dev, `VITE_API_URL` is usually unset (the app uses Vite's proxy
//     for /api and /socket.io). We return `undefined` so socket.io-client
//     targets the current window origin (http://localhost:5173) — Vite's
//     `ws: true` proxy then forwards the WS upgrade to the backend.
//   - In prod, either `VITE_API_URL` is baked into the bundle (points at
//     the API origin) OR the frontend is served from the same host as the
//     API and same-origin works out of the box.
//
// The API mounts under `/api/v1` but socket.io lives at the server root,
// so we strip the path portion of `VITE_API_URL` before use.
const deriveOrigin = () => {
  const raw = import.meta.env.VITE_API_URL || '';
  if (!raw) return undefined; // same-origin (dev: via Vite proxy; prod: co-hosted)
  try {
    const u = new URL(raw, window.location.origin);
    // If VITE_API_URL is a relative path (e.g. "/api/v1") the URL will
    // resolve to the current window origin — which is exactly what we
    // want; return undefined so socket.io-client uses the default.
    if (u.origin === window.location.origin) return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
};

let socket = null;

export function getSocket() {
  if (socket) return socket;
  socket = io(deriveOrigin(), {
    // Transport order is socket.io's default (`polling` first, then upgrade
    // to `websocket`). Forcing `['websocket', 'polling']` bypassed polling
    // entirely, which — on any reverse proxy NOT configured for the WS
    // Upgrade handshake (see deploy/nginx.conf.example) — produced a red
    // "WebSocket connection failed" in the browser console on every
    // reconnect attempt. With polling first, the client connects cleanly
    // and only upgrades to WS if the server accepts the Upgrade frame; a
    // failed upgrade is handled silently by socket.io.
    transports: ['polling', 'websocket'],
    withCredentials: true,
    // Reconnect indefinitely with exponential backoff. Cap at 30 s so the
    // browser never spams the server after a long outage.
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    autoConnect: true,
    // Handshake auth — the server verifies this via JWT_ACCESS_SECRET.
    // Re-read from the redux store on every reconnect so a refreshed
    // access token is picked up without tearing down the socket.
    auth: (cb) => cb({ token: store.getState().auth.accessToken || '' }),
  });
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  try { socket.removeAllListeners(); } catch { /* noop */ }
  try { socket.disconnect(); } catch { /* noop */ }
  socket = null;
}
