import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend origin used by all dev proxies below. Override with
// `BACKEND_URL=http://<host>:<port> npm run dev` when running the API on
// a different host (e.g. a VM or LAN dev box).
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';

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
