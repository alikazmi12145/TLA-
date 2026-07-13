/**
 * PM2 ecosystem configuration for the TLA HRMS backend.
 *
 * Deploy:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup       # once, to register with systemd
 *
 * Reload zero-downtime:
 *   pm2 reload tla-hrms-api
 *
 * NOTE: `instances: 1` (fork mode) is intentional. The biometric poller
 * maintains an in-process single TCP socket per ZKTeco device. Running
 * multiple Node instances (cluster) would each open their own socket and
 * duplicate every attendance import. If you ever need horizontal scaling
 * for HTTP throughput, move the biometric poller into its own dedicated
 * process (single instance) and cluster the API separately.
 */
module.exports = {
  apps: [
    {
      name: 'tla-hrms-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,

      // Cap V8's old-space heap explicitly at ~768 MB. This makes V8 do a
      // full GC BEFORE PM2 kills the process on the RSS ceiling — so a
      // legitimate spike (large payroll run, big attendance import) has
      // headroom to breathe instead of triggering a restart-storm. RSS
      // will settle around old-space + young-space + native modules
      // (node-zklib's TCP buffers) — comfortably under `max_memory_restart`.
      node_args: ['--max-old-space-size=768'],

      // Restart the process if RSS exceeds this ceiling. Guards against a
      // slow leak leading to OOM-kill by the kernel. 1 GB with the 768 MB
      // old-space cap gives 256 MB for native / young-gen / buffers on a
      // 4 GB VPS running Node + MongoDB side-by-side.
      max_memory_restart: '1024M',

      // Cap restart storms — if the process crashes 10 times in <60s, stop
      // trying so we don't chew CPU. `pm2 restart tla-hrms-api` clears it.
      max_restarts: 10,
      min_uptime: '60s',
      restart_delay: 3_000,
      exp_backoff_restart_delay: 200,

      // Give graceful-shutdown time to close the HTTP server, the K40
      // socket and the MongoDB connection. Must be < server.js's
      // `forceExit` deadline (15s) so PM2 doesn't SIGKILL first.
      kill_timeout: 20_000,
      listen_timeout: 10_000,
      wait_ready: false,

      // Route stdout / stderr to distinct files with timestamps.
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
