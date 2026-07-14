import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend origin used by all dev proxies below. Override with
// `BACKEND_URL=http://<host>:<port> npm run dev` when running the API on
// a different host (e.g. a VM or LAN dev box).
//
// Uses 127.0.0.1 (NOT `localhost`) on purpose. Node 17+ preserves the OS
// DNS resolution order for `localhost`, and on Windows that returns
// `::1` (IPv6) first. If the backend binds only to IPv4 (or vice-versa),
// Vite's proxy hits `AggregateError [ECONNREFUSED]` on every request
// before falling back — sometimes not falling back at all for websocket
// upgrades. Pinning to the IPv4 loopback dodges the whole mess.
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/uploads': { target: BACKEND, changeOrigin: true },
      // Socket.IO — MUST be a websocket-enabled proxy or the client's
      // ws://localhost:5173/socket.io/... upgrade fails with
      // "WebSocket is closed before the connection is established".
      // `ws: true` tells Vite to forward the Upgrade handshake to Node.
      '/socket.io': {
        target: BACKEND,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
