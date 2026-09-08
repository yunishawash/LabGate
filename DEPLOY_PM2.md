# LabGate — deploying to the plant server with pm2 (no Docker)

This is the non-Docker path: Node, Mongo and pm2 installed straight on the
server, the app supervised by pm2 instead of a container's restart policy.
`DEPLOY.md` documents the Docker Compose path if you'd rather use that
instead — pick one, the two are not meant to run side by side.

As in `DEPLOY.md`, everything here has been run at least once on the
development machine. What has **not** been done is anything involving the
real server, real TLS, or real people's passwords — the lines marked `[ ]`.

---

## 1. What you need on the server

- Node.js 22.x
- MongoDB 7, installed as a standalone `mongod` — **not** a replica set (see
  `src/lib/mongoose.ts`: nothing here uses a multi-document transaction, so a
  replica set buys nothing and adds the `not primary` failover failure mode)
- pm2 (`npm i -g pm2`)
- A reverse proxy for TLS — nginx or Caddy; pm2 only gets the app listening on
  `127.0.0.1:3001`, it doesn't terminate TLS
- A directory for backups with room for ~30 archives

Steps below assume Debian/Ubuntu; substitute your distro's package manager
where it appears.

---

## 2. Install Node, Mongo, pm2

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# MongoDB 7 (community edition)
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org

# Run standalone Mongo on 27020, not the default 27017 — the same convention
# .env.example uses locally, and it matters if this box also runs the CMMS's
# Mongo on 27017.
sudo sed -i 's/port: 27017/port: 27020/' /etc/mongod.conf
# bindIp should stay 127.0.0.1 — Mongo has no business listening beyond
# localhost; the app on this same host is its only client.
sudo systemctl enable --now mongod

npm install -g pm2
```

Confirm: `mongosh --port 27020 --eval "db.adminCommand('ping')"` should print
`{ ok: 1 }`.

---

## 3. First deploy

```bash
git clone <repo> /srv/labgate && cd /srv/labgate
npm ci
```

Write `/srv/labgate/.env.local` (Next.js loads it automatically, in
production exactly as in dev — nothing else needs to inject these):

```bash
MONGODB_URI=mongodb://127.0.0.1:27020/labgate
AUTH_SECRET=$(openssl rand -base64 32)   # MUST differ from the CMMS's
AUTH_URL=https://lab.gwmc.local          # the real public origin — see §4
UPLOAD_DIR=/srv/labgate-uploads          # OUTSIDE the repo — see §6
```

```bash
mkdir -p /srv/labgate-uploads
npm run build
pm2 start ecosystem.config.cjs
pm2 save                 # so `pm2 resurrect` on boot brings this back
pm2 startup systemd      # prints a command — run the one it prints, as root
```

Then create the accounts:

```bash
npx tsx src/scripts/seed-production.ts
```

That prints nine passwords **once**. Write them down, hand each to its owner,
and have every one changed on first login. The script refuses to run against
a database that already holds orders — if you built and tested locally with
seeded demo data before pushing, clear it first (§7).

---

## 4. TLS — decide before anyone logs in

Same functional dependency as the Docker path: the session cookie's `secure`
flag follows `AUTH_URL` ([auth.config.ts](src/lib/auth.config.ts)):
`https://…` sets it, `http://…` does not. **`secure: true` served over plain
HTTP makes the browser discard the cookie, and login silently does nothing.**

pm2 does not terminate TLS — put nginx or Caddy in front of it:

```nginx
server {
    listen 443 ssl;
    server_name lab.gwmc.local;
    ssl_certificate     /etc/ssl/lab.gwmc.local.crt;
    ssl_certificate_key /etc/ssl/lab.gwmc.local.key;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

| Choice | `AUTH_URL` | Consequence |
|---|---|---|
| **TLS via nginx/Caddy** (recommended) | `https://lab.gwmc.local` | Cookie is `secure`. An internal CA certificate is fine, it does not have to be public. |
| **Plain HTTP on the LAN** | `http://10.x.x.x:3001` | Works, but session cookies cross the network in the clear. Acceptable only on a switched plant LAN that outsiders cannot reach. |

- [ ] TLS decision made and written down
- [ ] `AUTH_URL` matches the scheme actually served
- [ ] Reverse proxy forwards `X-Forwarded-Proto` (Next.js needs it to know the request arrived over TLS)

---

## 5. Backups

`ops/backup.sh` and `ops/restore.sh` already work with a host-installed Mongo
— they only use Docker when a `labgate-mongo` container exists, and fall back
to plain `mongodump`/`mongorestore` otherwise, which is this setup. Point them
at the right port:

```bash
crontab -e
15 3 * * * MONGODB_URI=mongodb://127.0.0.1:27020/labgate /srv/labgate/ops/backup.sh >> /var/log/labgate-backup.log 2>&1
```

**Rehearse the restore. A backup nobody has restored is a hope.**

```bash
MONGODB_URI=mongodb://127.0.0.1:27020 ops/restore.sh backups/labgate-YYYY-MM-DD_HHMM.archive.gz
```

It restores into `labgate_restore_check`, never over the live database, and
prints document counts and the newest order number to compare against the
live system. Restoring over production needs `--into labgate --force`, typed
deliberately.

- [ ] Cron installed
- [ ] One restore rehearsed **on the server**, counts compared

---

## 6. Uploads

`UPLOAD_DIR` must point **outside** `/srv/labgate` (the repo directory) —
`/srv/labgate-uploads` above. There's no container volume doing this for you
here: a redeploy is a `git pull`, which only touches files tracked in the
repo, so anything under `UPLOAD_DIR` survives automatically as long as the
path itself is outside the repo tree. Putting it inside the repo by mistake
is the one way to lose it (`.gitignore`'s `/uploads/` rule is a safety net for
exactly that case, not a plan).

- [ ] `UPLOAD_DIR` confirmed outside `/srv/labgate`
- [ ] Upload a file, `git pull && npm run build && pm2 reload labgate`, confirm it still loads

---

## 7. Clearing demo/dev data before go-live

If this database was seeded locally (`npm run seed`, `seed-lab`,
`seed-demo-orders.ts`, or walked through with `scripts/walk-ui.mjs`) before
being pushed to the server, `seed-production.ts` will refuse to run — it
checks for any existing order as its signal that the database isn't fresh.

`src/scripts/clear-demo-data.ts` resets that: it deletes sales orders, lab
samples, audit log entries, notifications, and the order-numbering counters
(so real orders start again at 1). It leaves users, customers, and lab
parameters/thresholds/products alone — those are configuration, not dump
data. It defaults to a dry run; nothing is deleted without `--yes`.

```bash
npm run clear:demo                 # dry run — prints what would be removed
npm run clear:demo -- --yes        # actually clears it
```

Then run `seed-production.ts` as in §3.

- [ ] Ran `clear:demo` (dry run first, read the output) before seeding production
- [ ] Confirmed against the **server's** database, not a laptop pointed at it by habit

---

## 8. Cookie isolation from the CMMS

Cookies ignore port numbers. If the CMMS runs on `:3000` and LabGate on
`:3001` on the same host, they'd share one cookie jar — both are NextAuth.
Two things keep them apart, and both must hold:

1. The cookie is named `gwmc-lab.session-token`, not `authjs.session-token`
   ([auth.config.ts](src/lib/auth.config.ts))
2. `AUTH_SECRET` differs from the CMMS's

- [ ] Logging into LabGate does **not** log the user out of the CMMS
- [ ] And the reverse

---

## 9. Redeploying / rolling back

```bash
cd /srv/labgate
git pull                    # or: git checkout <tag>
npm ci
npm run build
pm2 reload labgate          # zero-downtime: pm2 starts the new process before killing the old
```

`pm2 reload` (not `restart`) is what makes this safe to do during working
hours — it waits for the new process to be listening before it drops the old
one.

Rolling back is the same sequence against the previous tag. If data must go
back too:

```bash
ops/restore.sh backups/<archive> --into labgate --force
```

Restoring over the live database discards everything written since that
archive. Know what that window contains before you type it.

- [ ] Rollback path agreed: previous git tag + last verified backup

---

## 10. Keeping pm2 itself healthy

```bash
pm2 status              # is it up, how many restarts, memory
pm2 logs labgate         # tail stdout/stderr
pm2 monit                # live CPU/memory
```

Log rotation — pm2 does not rotate its own logs by default, and
`ecosystem.config.cjs` writes to `logs/out.log` / `logs/error.log` inside the
repo, which will grow forever otherwise:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

- [ ] `pm2 startup` command run as root, so pm2 (and LabGate) comes back after a reboot
- [ ] `pm2-logrotate` installed

---

## 11. Go-live checklist

Same substance as `DEPLOY.md` §7 — repeated here for this path:

- [ ] `npx tsc --noEmit` clean · `npm run build` succeeds · `vitest` green
- [ ] Mongo is standalone (not a replica set) and accepts writes on 27020
- [ ] Session cookie is `gwmc-lab.*` with an env-driven `secure` flag
- [ ] `.env.local` set: `MONGODB_URI`, real `AUTH_URL`, a **fresh** `AUTH_SECRET`, `UPLOAD_DIR`
- [ ] Demo data cleared (`npm run clear:demo -- --yes`) if this database was ever seeded locally
- [ ] Production seed run; every printed password handed over and changed
- [ ] Backup cron installed and one restore rehearsed **there**
- [ ] `UPLOAD_DIR` confirmed outside the repo and survives a `git pull` + redeploy
- [ ] Cookie isolation confirmed against the live CMMS
- [ ] `pm2 startup` configured so the app survives a reboot
- [ ] All nine people log in once, on their own machines
- [ ] One real order walked 1 → 8 by the actual staff
- [ ] Rollback path agreed: previous git tag + last verified backup
