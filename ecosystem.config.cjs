// pm2 process definition for LabGate, running directly on the plant server —
// no Docker. See DEPLOY_PM2.md for the full setup (Node, Mongo, nginx/TLS,
// backups, first boot).
//
// Runs `next start` through node directly rather than through `npm run
// start`: pm2 needs to hold the actual server process so it can restart it on
// crash and forward signals for a clean shutdown — going through npm (and
// npm going through a shell) adds a layer that swallows both.
//
// Next.js loads `.env.local` itself (see .env.example) exactly as it does in
// dev, so production secrets live in that one file on the server and nothing
// needs injecting here.
//
//   pm2 start ecosystem.config.cjs
//   pm2 save                        # persist across reboots (after `pm2 startup`)
//   pm2 logs labgate
//   pm2 reload labgate              # zero-downtime restart after a deploy
module.exports = {
  apps: [
    {
      name: "labgate",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
