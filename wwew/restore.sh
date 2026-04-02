#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKUPS_DIR="$ROOT/backups"

echo "============================================"
echo "  SMC Bot — Restore"
echo "============================================"

# ── Resolve which archive to restore ─────────────────────────────────────────
if [ -n "$1" ]; then
  ARCHIVE="$1"
  # Handle relative paths
  if [[ "$ARCHIVE" != /* ]]; then
    ARCHIVE="$ROOT/$ARCHIVE"
  fi
else
  # Auto-detect latest
  if [ -L "$BACKUPS_DIR/latest.tar.gz" ]; then
    ARCHIVE=$(readlink -f "$BACKUPS_DIR/latest.tar.gz")
  elif ls "$BACKUPS_DIR"/backup_*.tar.gz 2>/dev/null | head -1 > /dev/null; then
    ARCHIVE=$(ls -t "$BACKUPS_DIR"/backup_*.tar.gz | head -1)
  else
    echo ""
    echo "  ERROR: No backup found."
    echo ""
    echo "  Usage:"
    echo "    bash restore.sh                         (uses latest backup)"
    echo "    bash restore.sh backups/backup_XYZ.tar.gz"
    echo ""
    echo "  Available backups:"
    ls "$BACKUPS_DIR"/*.tar.gz 2>/dev/null || echo "    (none)"
    exit 1
  fi
fi

if [ ! -f "$ARCHIVE" ]; then
  echo ""
  echo "  ERROR: Archive not found: $ARCHIVE"
  exit 1
fi

echo ""
echo "  Archive  : $(basename "$ARCHIVE")"
echo "  Size     : $(du -sh "$ARCHIVE" | cut -f1)"

# ── Check required env ────────────────────────────────────────────────────────
echo ""
echo "==> [1/5] Checking environment..."
if [ -z "$DATABASE_URL" ]; then
  echo "    ERROR: DATABASE_URL is not set."
  echo "           Set it in the Replit Secrets / environment tab first."
  exit 1
fi
echo "    DATABASE_URL  : ✅ set"
echo "    TELEGRAM_BOT_TOKEN : $([ -n "$TELEGRAM_BOT_TOKEN" ] && echo '✅ set' || echo '⚠️  NOT SET — add after restore')"
echo "    TELEGRAM_CHAT_ID   : $([ -n "$TELEGRAM_CHAT_ID" ] && echo "✅ $TELEGRAM_CHAT_ID" || echo '⚠️  NOT SET — add after restore')"

# ── Extract archive ───────────────────────────────────────────────────────────
echo ""
echo "==> [2/5] Extracting archive..."
EXTRACT_DIR="$ROOT/.restore_tmp"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"

# The archive contains a single hidden stage folder — find it
STAGE=$(find "$EXTRACT_DIR" -maxdepth 1 -name ".backup_stage_*" -type d | head -1)
if [ -z "$STAGE" ]; then
  echo "    ERROR: Archive format not recognised. Expected .backup_stage_* folder inside."
  rm -rf "$EXTRACT_DIR"
  exit 1
fi

# Show metadata if present
if [ -f "$STAGE/backup_meta.txt" ]; then
  echo ""
  echo "  --- Backup info ---"
  cat "$STAGE/backup_meta.txt"
  echo "  -------------------"
fi

echo "    Extracted OK"

# ── Restore source files ──────────────────────────────────────────────────────
echo ""
echo "==> [3/5] Restoring source files..."

restore_dir() {
  local SRC="$STAGE/$1"
  local DST="$ROOT/$2"
  if [ -d "$SRC" ] || [ -f "$SRC" ]; then
    mkdir -p "$DST"
    cp -r "$SRC/." "$DST/"
    echo "    ✓ $2"
  else
    echo "    ⚠  skipped (not in backup): $1"
  fi
}

restore_dir "artifacts/api-server/src"  "artifacts/api-server/src"
restore_dir "artifacts/dashboard/src"   "artifacts/dashboard/src"
restore_dir "lib/db/src"               "lib/db/src"
restore_dir "lib/api-client-react/src" "lib/api-client-react/src"
restore_dir "lib/api-spec"             "lib/api-spec"
restore_dir "lib/api-zod/src"         "lib/api-zod/src"

# Root config files
for FILE in package.json pnpm-workspace.yaml tsconfig.json tsconfig.base.json \
            artifacts/api-server/build.mjs artifacts/api-server/package.json \
            artifacts/api-server/tsconfig.json \
            artifacts/dashboard/package.json artifacts/dashboard/vite.config.ts \
            artifacts/dashboard/tsconfig.json artifacts/dashboard/components.json \
            lib/db/drizzle.config.ts lib/db/package.json lib/db/tsconfig.json \
            lib/api-client-react/package.json; do
  SRC="$STAGE/$FILE"
  DST="$ROOT/$FILE"
  if [ -f "$SRC" ]; then
    mkdir -p "$(dirname "$DST")"
    cp "$SRC" "$DST"
  fi
done

# Restore pnpm-lock.yaml only if present (don't fail if missing)
[ -f "$STAGE/pnpm-lock.yaml" ] && cp "$STAGE/pnpm-lock.yaml" "$ROOT/" || true

echo "    Source files restored"

# ── Install dependencies ──────────────────────────────────────────────────────
echo ""
echo "==> [4/5] Installing dependencies (this may take a minute)..."
cd "$ROOT"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo "    Dependencies installed"

# ── Restore database ──────────────────────────────────────────────────────────
echo ""
echo "==> [5/5] Restoring database..."

SQL="$STAGE/backup.sql"
if [ ! -f "$SQL" ]; then
  echo "    WARNING: No backup.sql found in archive — skipping DB restore"
else
  # Drop existing tables cleanly then restore
  echo "    Dropping existing tables..."
  psql "$DATABASE_URL" -c "
    DO \$\$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END \$\$;
  " > /dev/null 2>&1 || true

  echo "    Restoring from SQL dump..."
  psql "$DATABASE_URL" < "$SQL"

  echo "    Running schema migrations..."
  cd "$ROOT/lib/db" && npx drizzle-kit push --force 2>/dev/null || npx drizzle-kit push
  cd "$ROOT"

  RESTORED=$(psql "$DATABASE_URL" -t -c "
    SELECT COALESCE(
      (SELECT COUNT(*)::text FROM trades) || ' trades, ' ||
      (SELECT COUNT(*)::text FROM signals) || ' signals',
      '0 records'
    );
  " 2>/dev/null | tr -d ' \n') || RESTORED="(check manually)"
  echo "    Restored: $RESTORED"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "$EXTRACT_DIR"

echo ""
echo "============================================"
echo "  ✅ Restore complete!"
echo ""
echo "  Next steps:"
echo "  1. Ensure your secrets are set in Replit:"
echo "       TELEGRAM_BOT_TOKEN  = <your bot token>"
echo "       TELEGRAM_CHAT_ID    = ${TELEGRAM_CHAT_ID:-5851227801}"
echo "       DATABASE_URL        = <auto-set by Replit DB>"
echo ""
echo "  2. Start the servers:"
echo "       pnpm --filter @workspace/api-server run dev"
echo "       pnpm --filter @workspace/dashboard  run dev"
echo "============================================"
