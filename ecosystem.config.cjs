// pm2 process definition for LabGate, running directly on the plant server —
// no Docker. See DEPLOY_PM2.md for the full setup (Node, Mongo, nginx/TLS,
// backups, first boot).
//
// Runs the STANDALONE server (.next/standalone/server.js), not `next start`.
// next.config.mjs sets `output: "standalone"` (for the Docker path in
// DEPLOY.md), and `next start` refuses to run against that build at all —
// it prints "does not work with output: standalone" and never really starts.
// The standalone server is also what Next itself recommends running under a
// process manager: it's the same production server without the CLI wrapper,
// so pm2 holds the real node process directly, restarts it on crash, and can
// forward signals for a clean shutdown.
//
// `npm run build`'s `postbuild` step (package.json) copies `public/`,
// `.next/static/`, AND `.env.local` into `.next/standalone/` — the
// standalone output traces only server JS, nothing else, and Next expects
// static assets AND env files placed there by hand (Docker's Dockerfile
// does the equivalent for the first two with COPY; env files it handles
// differently, via docker-compose's `environment:`, since containers don't
// use a checked-in .env.local at all). Skipping the static-assets copy is
// why CSS/JS/images would 404 with the server otherwise up; skipping the
// .env.local copy is why it boots but throws `MissingSecret` from
// NextAuth and can't reach Mongo — the standalone server.js does NOT
// auto-load .env.local the way `next dev`/`next start` do.
//
//   npm run build                   # also runs postbuild, see above
//   pm2 start ecosystem.config.cjs
//   pm2 save                        # persist across reboots (after `pm2 startup`)
//   pm2 logs labgate
//   pm2 reload labgate              # zero-downtime restart after a deploy
module.exports = {
  apps: [
    {
      name: "labgate",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        // Loopback only — nginx/Caddy (DEPLOY_PM2.md §4) is what the outside
        // world actually reaches; the app itself never needs to.
        HOSTNAME: "127.0.0.1",
      },
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
