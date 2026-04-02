#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKUPS_DIR="$ROOT/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE="$BACKUPS_DIR/backup_$TIMESTAMP.tar.gz"
STAGE="$ROOT/.backup_stage_$TIMESTAMP"

mkdir -p "$BACKUPS_DIR"

echo "============================================"
echo "  SMC Bot — Backup  ($TIMESTAMP)"
echo "============================================"

# ── 1. Database dump ─────────────────────────────────────────────────────────
echo ""
echo "==> [1/3] Dumping database..."
if [ -z "$DATABASE_URL" ]; then
  echo "    ERROR: DATABASE_URL is not set. Cannot dump database."
  exit 1
fi
mkdir -p "$STAGE"
pg_dump "$DATABASE_URL" > "$STAGE/backup.sql"
ROWS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')
echo "    Done — $ROWS tables exported"

# ── 2. Stage source files ─────────────────────────────────────────────────────
echo ""
echo "==> [2/3] Staging source files..."
mkdir -p \
  "$STAGE/artifacts/api-server" \
  "$STAGE/artifacts/dashboard" \
  "$STAGE/lib/db" \
  "$STAGE/lib/api-client-react" \
  "$STAGE/lib/api-spec" \
  "$STAGE/lib/api-zod"

# API server
cp -r "$ROOT/artifacts/api-server/src"         "$STAGE/artifacts/api-server/"
cp    "$ROOT/artifacts/api-server/build.mjs"    "$STAGE/artifacts/api-server/"
cp    "$ROOT/artifacts/api-server/package.json" "$STAGE/artifacts/api-server/"
cp    "$ROOT/artifacts/api-server/tsconfig.json" "$STAGE/artifacts/api-server/"

# Dashboard
cp -r "$ROOT/artifacts/dashboard/src"            "$STAGE/artifacts/dashboard/"
cp    "$ROOT/artifacts/dashboard/package.json"   "$STAGE/artifacts/dashboard/"
cp    "$ROOT/artifacts/dashboard/vite.config.ts" "$STAGE/artifacts/dashboard/"
cp    "$ROOT/artifacts/dashboard/tsconfig.json"  "$STAGE/artifacts/dashboard/"
cp    "$ROOT/artifacts/dashboard/components.json" "$STAGE/artifacts/dashboard/"

# Shared libraries
cp -r "$ROOT/lib/db/src"                    "$STAGE/lib/db/"
cp    "$ROOT/lib/db/drizzle.config.ts"      "$STAGE/lib/db/"
cp    "$ROOT/lib/db/package.json"           "$STAGE/lib/db/"
cp    "$ROOT/lib/db/tsconfig.json"          "$STAGE/lib/db/"

cp -r "$ROOT/lib/api-client-react/src"      "$STAGE/lib/api-client-react/"
cp    "$ROOT/lib/api-client-react/package.json" "$STAGE/lib/api-client-react/"

cp -r "$ROOT/lib/api-spec/."               "$STAGE/lib/api-spec/"
cp -r "$ROOT/lib/api-zod/src"              "$STAGE/lib/api-zod/"
if [ -f "$ROOT/lib/api-zod/package.json" ]; then
  cp "$ROOT/lib/api-zod/package.json" "$STAGE/lib/api-zod/"
fi

# Root config files
cp "$ROOT/package.json"          "$STAGE/"
cp "$ROOT/pnpm-workspace.yaml"   "$STAGE/" 2>/dev/null || true
cp "$ROOT/pnpm-lock.yaml"        "$STAGE/" 2>/dev/null || true
cp "$ROOT/tsconfig.json"         "$STAGE/"
cp "$ROOT/tsconfig.base.json"    "$STAGE/" 2>/dev/null || true
cp "$ROOT/backup.sh"             "$STAGE/"
cp "$ROOT/restore.sh"            "$STAGE/"

# Write a metadata file
cat > "$STAGE/backup_meta.txt" <<META
Backup created : $TIMESTAMP
Database tables: $ROWS
Node version   : $(node --version 2>/dev/null || echo "unknown")
pnpm version   : $(pnpm --version 2>/dev/null || echo "unknown")
TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID:-NOT SET}

=== Secrets needed for restore ===
  TELEGRAM_BOT_TOKEN  (get from BotFather)
  TELEGRAM_CHAT_ID    = ${TELEGRAM_CHAT_ID:-5851227801}
  DATABASE_URL        (get from Replit DB integration)
META

echo "    Done"

# ── 3. Compress ───────────────────────────────────────────────────────────────
echo ""
echo "==> [3/3] Compressing archive..."
tar -czf "$ARCHIVE" -C "$ROOT" ".backup_stage_$TIMESTAMP"
rm -rf "$STAGE"
SIZE=$(du -sh "$ARCHIVE" | cut -f1)
echo "    Done — $SIZE"

# ── Keep only 5 most recent backups ──────────────────────────────────────────
BACKUP_COUNT=$(ls "$BACKUPS_DIR"/backup_*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 5 ]; then
  echo ""
  echo "==> Pruning old backups (keeping 5 most recent)..."
  ls -t "$BACKUPS_DIR"/backup_*.tar.gz | tail -n +6 | while read OLD; do
    echo "    Removing: $(basename "$OLD")"
    rm "$OLD"
  done
fi

# ── Also keep a symlink to the latest ────────────────────────────────────────
ln -sf "$ARCHIVE" "$BACKUPS_DIR/latest.tar.gz"

echo ""
echo "============================================"
echo "  ✅ Backup complete!"
echo "     Archive : backups/backup_$TIMESTAMP.tar.gz"
echo "     Size    : $SIZE"
echo ""
echo "  To restore:"
echo "     bash restore.sh backups/backup_$TIMESTAMP.tar.gz"
echo "     bash restore.sh   (uses latest automatically)"
echo "============================================"
