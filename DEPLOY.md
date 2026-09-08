# LabGate — deploying to the plant server

Everything here has been run at least once on the development machine. What has
**not** been done is anything involving the real server, real TLS, or real
people's passwords — those are the lines below marked `[ ]`.

---

## 1. What you need on the server

- Docker with Compose v2 (`docker compose version`)
- A DNS name or a fixed IP the office machines can reach
- A directory for backups with room for ~30 archives

Nothing else. Node, Mongo and the build toolchain all live inside the images.

---

## 2. First deploy

```bash
git clone <repo> /srv/labgate && cd /srv/labgate

# Generate a secret. It must NOT be the CMMS's — see §5 below.
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "AUTH_URL=https://lab.gwmc.local" >> .env      # the real origin
echo "APP_PORT=3001" >> .env

docker compose up -d --build
docker compose logs -f app          # watch it come up
```

Then create the accounts:

```bash
docker compose exec app node -e "1" >/dev/null   # confirm the container runs
docker compose run --rm app npx tsx src/scripts/seed-production.ts
```

That prints nine passwords **once**. Write them down, hand each to its owner,
and have every one changed on first login. The script refuses to run against a
database that already holds orders — after go-live, create people through the
Users screen, which audits what it does.

---

## 3. TLS — decide before anyone logs in

The session cookie's `secure` flag follows `AUTH_URL`
([auth.config.ts](src/lib/auth.config.ts)): `https://…` sets it, `http://…`
does not. This is not a preference, it is a functional dependency —
**`secure: true` over plain HTTP makes the browser discard the cookie, and
login appears to do nothing at all**, with no error anywhere.

| Choice | `AUTH_URL` | Consequence |
|---|---|---|
| **TLS** (recommended) | `https://lab.gwmc.local` | Cookie is `secure`. Needs a certificate — an internal CA is fine, it does not have to be public. |
| **Plain HTTP on the LAN** | `http://10.x.x.x:3001` | Works, but session cookies cross the network in the clear. Acceptable only on a switched plant LAN that outsiders cannot reach. |

Do not put `https://` in `AUTH_URL` and terminate TLS nowhere — that is the
combination that produces the silent login failure.

- [ ] TLS decision made and written down
- [ ] `AUTH_URL` matches the scheme actually served

---

## 4. Backups

```bash
crontab -e
15 3 * * * /srv/labgate/ops/backup.sh >> /var/log/labgate-backup.log 2>&1
```

`ops/backup.sh` dumps, gzips, verifies the archive's own integrity, and prunes
past `RETAIN_DAYS` (default 30). It exits non-zero on any problem so cron's mail
is the alert.

**Rehearse the restore. A backup nobody has restored is a hope.**

```bash
ops/restore.sh backups/labgate-YYYY-MM-DD_HHMM.archive.gz
```

It restores into `labgate_restore_check`, never over the live database, and
prints the document counts and the newest order number. Compare them with the
live system. Restoring over production needs `--into labgate --force`, typed
deliberately.

- [ ] Cron installed
- [ ] One restore rehearsed **on the server**, counts compared

---

## 5. Cookie isolation from the CMMS

Cookies ignore port numbers. The CMMS on `:3000` and LabGate on `:3001` share
one cookie jar on the same host, and both are NextAuth. Two things keep them
apart, and both must hold:

1. The cookie is named `gwmc-lab.session-token`, not `authjs.session-token`
   ([auth.config.ts](src/lib/auth.config.ts))
2. `AUTH_SECRET` differs from the CMMS's

- [ ] Logging into LabGate does **not** log the user out of the CMMS
- [ ] And the reverse

---

## 6. Uploads

`UPLOAD_DIR=/uploads` inside the container is a named volume, deliberately
outside the image. Anything written there without the volume disappears on the
next deploy — which is how a year of QC attachments gets lost quietly.

- [ ] Upload a file, `docker compose up -d --build`, confirm it still loads

---

## 7. Go-live checklist (SPEC §19.8)

Verified on the development machine — re-run on the server:

- [x] `npx tsc --noEmit` clean · `npm run build` succeeds · `vitest` green (40 tests)
- [x] Mongo is standalone and accepts writes
- [x] Session cookie is `gwmc-lab.*` with an env-driven `secure` flag
- [x] One complete order walked 1 → 8 → Posted, **in Arabic and in English**
      (`scripts/walk-ui.mjs en` / `ar`)
- [x] One order rejected mid-chain, confirmed invisible downstream and closed
      (`scripts/visibility-matrix.mjs`, `scripts/order-rules.mjs`)
- [x] All nine roles logged in; each lands correctly and sees only its own
      sidebar (`scripts/check-navigation.mjs`)
- [x] A restore rehearsed into a scratch database, counts compared

Still to do on the real server:

- [ ] `.env` set: `MONGODB_URI`, real `AUTH_URL`, a **fresh** `AUTH_SECRET`, `UPLOAD_DIR`
- [ ] Production seed run; every printed password handed over and changed
- [ ] Backup cron installed and one restore rehearsed **there**
- [ ] `UPLOAD_DIR` volume survives a redeploy
- [ ] Cookie isolation confirmed against the live CMMS
- [ ] All nine people log in once, on their own machines
- [ ] One real order walked 1 → 8 by the actual staff
- [ ] The three open decisions below answered, or their defaults accepted in writing
- [ ] Rollback path agreed: previous image tag + last verified backup

---

## 8. Still open — needs the client

| Question | Default if nobody answers |
|---|---|
| The 11 uncertain customer names (SPEC §17) | Left as entered; fix through the Customers screen |
| Sales coordinator: own orders only, or the whole department? | **Own only** — one flag in `ROLE_FLAGS` ([salesWorkflow.ts](src/lib/salesWorkflow.ts)) |
| The aging threshold before an order shows red | **48 hours** — `STUCK_HOURS` ([dashboardBlocks.ts](src/lib/dashboardBlocks.ts)) |

Each is a one-line change, deliberately.

---

## 9. Rolling back

```bash
docker compose down
git checkout <previous-tag> && docker compose up -d --build
# and if data must go back too:
ops/restore.sh backups/<archive> --into labgate --force
```

Restoring over the live database discards everything written since that
archive. Know what that window contains before you type it.
