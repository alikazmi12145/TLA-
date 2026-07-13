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

// Derive the socket URL from VITE_API_URL. The API mounts under `/api/v1`
// but socket.io lives at the server root, so strip the path portion.
const deriveOrigin = () => {
  const raw = import.meta.env.VITE_API_URL || '';
  if (!raw) return undefined; // same-origin
  try {
    const u = new URL(raw, window.location.origin);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
};

let socket = null;

export function getSocket() {
  if (socket) return socket;
  socket = io(deriveOrigin(), {
    transports: ['websocket', 'polling'],
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
