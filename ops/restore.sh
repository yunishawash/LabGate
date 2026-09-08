#!/usr/bin/env bash
#
# LabGate restore.
#
# A backup nobody has restored is a hope, not a backup. This is the script the
# go-live checklist requires you to have RUN, not merely to possess.
#
# By default it restores into a SCRATCH database, never over the live one, so a
# rehearsal cannot become an incident:
#
#   ops/restore.sh backups/labgate-2026-09-07_0315.archive.gz
#   ops/restore.sh <archive> --into labgate            # the real thing
#
# Restoring over the live database requires --force as well, typed deliberately.

set -Eeuo pipefail

ARCHIVE="${1:-}"
TARGET="labgate_restore_check"
FORCE=0
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --into) TARGET="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SOURCE_DB="${MONGO_DB:-labgate}"
CONTAINER="${MONGO_CONTAINER:-labgate-mongo}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

[ -n "$ARCHIVE" ] || fail "usage: ops/restore.sh <archive.gz> [--into DB] [--force]"
[ -f "$ARCHIVE" ] || fail "no such archive: $ARCHIVE"
gzip -t "$ARCHIVE" 2>/dev/null || fail "archive fails its gzip integrity check — do not trust it"

if [ "$TARGET" = "$SOURCE_DB" ] && [ "$FORCE" -ne 1 ]; then
  fail "refusing to restore over the live database '$SOURCE_DB' without --force"
fi

log "restoring $ARCHIVE into '$TARGET'"

# --drop so the target is exactly the archive, not the archive merged into
# whatever was already there — a merge would silently keep deleted documents.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  docker exec -i "$CONTAINER" mongorestore --archive --gzip --drop \
    --nsFrom "$SOURCE_DB.*" --nsTo "$TARGET.*" < "$ARCHIVE" || fail "mongorestore returned non-zero"
  COUNT_CMD=(docker exec "$CONTAINER" mongosh --quiet --eval)
else
  URI="${MONGODB_URI:-mongodb://localhost:27020}"
  mongorestore --uri "$URI" --archive --gzip --drop \
    --nsFrom "$SOURCE_DB.*" --nsTo "$TARGET.*" < "$ARCHIVE" || fail "mongorestore returned non-zero"
  COUNT_CMD=(mongosh "$URI" --quiet --eval)
fi

# The rehearsal only counts if we look at what came back.
log "verifying:"
"${COUNT_CMD[@]}" "
  const db = db.getSiblingDB('$TARGET');
  for (const c of ['users','salesorders','labsamples','labcustomers','auditlogs']) {
    print('  ' + c.padEnd(16) + db.getCollection(c).countDocuments());
  }
  // find().sort().limit(1), not findOne(filter, {sort}) — mongosh reads that
  // second argument as a PROJECTION, so the first version returned a document
  // holding only _id and printed 'undefined' while claiming the check passed.
  // A verification step that cannot fail is not a verification step.
  const o = db.salesorders.find({}).sort({createdAt:-1}).limit(1).toArray()[0];
  print('  newest order    ' + (o ? o.orderNumber : 'NONE — the restore is empty'));
  if (!o) { print('  *** VERIFY FAILED ***'); quit(1); }
"

log "ok · restored into '$TARGET'"
[ "$TARGET" != "$SOURCE_DB" ] && log "drop the scratch copy when done: db.getSiblingDB('$TARGET').dropDatabase()"
