#!/usr/bin/env bash
#
# LabGate nightly backup.
#
# Writes a compressed archive per night and prunes anything older than
# RETAIN_DAYS. Designed to be dull: no cleverness, no partial states, and a
# non-zero exit the moment anything is wrong, so cron's own mail is the alert.
#
#   ops/backup.sh                    # host mongo, ./backups
#   BACKUP_DIR=/srv/lg ops/backup.sh # elsewhere
#
# Cron (03:15 nightly, log kept):
#   15 3 * * * /srv/labgate/ops/backup.sh >> /var/log/labgate-backup.log 2>&1

set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups}"
CONTAINER="${MONGO_CONTAINER:-labgate-mongo}"
DB="${MONGO_DB:-labgate}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
STAMP="$(date +%Y-%m-%d_%H%M)"
ARCHIVE="$BACKUP_DIR/labgate-$STAMP.archive.gz"

mkdir -p "$BACKUP_DIR"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

# Prefer the container; fall back to a mongodump on the host. Either way the
# command is the same shape, so there is one code path to reason about.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  log "dumping $DB from container $CONTAINER"
  docker exec "$CONTAINER" mongodump --db "$DB" --archive --gzip > "$ARCHIVE" \
    || fail "mongodump in container returned non-zero"
elif command -v mongodump >/dev/null 2>&1; then
  URI="${MONGODB_URI:-mongodb://localhost:27020/$DB}"
  log "dumping $DB from $URI"
  mongodump --uri "$URI" --archive --gzip > "$ARCHIVE" \
    || fail "mongodump returned non-zero"
else
  fail "neither the $CONTAINER container nor a local mongodump is available"
fi

# An archive that exists is not an archive that is usable. A dump that failed
# midway still leaves a file, and the failure would go unnoticed until the day
# it mattered most.
SIZE=$(wc -c < "$ARCHIVE")
[ "$SIZE" -gt 1024 ] || fail "archive is only ${SIZE} bytes — treating as a failed dump"
gzip -t "$ARCHIVE" 2>/dev/null || fail "archive fails its own gzip integrity check"

if [ "$SIZE" -ge 1048576 ]; then
  log "wrote $ARCHIVE ($((SIZE / 1048576)) MiB)"
else
  log "wrote $ARCHIVE ($((SIZE / 1024)) KiB)"
fi

DELETED=$(find "$BACKUP_DIR" -name 'labgate-*.archive.gz' -type f -mtime "+$RETAIN_DAYS" -print -delete | wc -l | tr -d ' ')
[ "$DELETED" -gt 0 ] && log "pruned $DELETED archive(s) older than $RETAIN_DAYS days"

log "ok · $(find "$BACKUP_DIR" -name 'labgate-*.archive.gz' | wc -l | tr -d ' ') archive(s) retained"
