#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKUPS_DIR="$ROOT/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE="$BACKUPS_DIR/code_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUPS_DIR"

echo "============================================"
echo "  SMC Bot — Code Backup  ($TIMESTAMP)"
echo "  (No database history)"
echo "============================================"

echo ""
echo "==> Packaging source files..."

tar -czf "$ARCHIVE" \
  -C "$ROOT" \
  --exclude="node_modules" \
  --exclude="*/dist" \
  --exclude="backups" \
  --exclude=".backup_stage_*" \
  --exclude=".restore_tmp" \
  --exclude="*.tar.gz" \
  --exclude="backup.sql" \
  --exclude="backup_export" \
  artifacts/api-server/src \
  artifacts/api-server/build.mjs \
  artifacts/api-server/package.json \
  artifacts/api-server/tsconfig.json \
  artifacts/dashboard/src \
  artifacts/dashboard/index.html \
  artifacts/dashboard/package.json \
  artifacts/dashboard/vite.config.ts \
  artifacts/dashboard/tsconfig.json \
  artifacts/dashboard/components.json \
  lib/db/src \
  lib/db/drizzle.config.ts \
  lib/db/package.json \
  lib/db/tsconfig.json \
  lib/api-client-react/src \
  lib/api-client-react/package.json \
  lib/api-client-react/tsconfig.json \
  lib/api-spec \
  lib/api-zod/src \
  lib/api-zod/package.json \
  lib/api-zod/tsconfig.json \
  package.json \
  tsconfig.json \
  backup_code.sh \
  backup.sh \
  restore.sh \
  setup_new_account.sh \
  $([ -f "$ROOT/pnpm-workspace.yaml" ] && echo "pnpm-workspace.yaml") \
  $([ -f "$ROOT/pnpm-lock.yaml" ]      && echo "pnpm-lock.yaml") \
  $([ -f "$ROOT/tsconfig.base.json" ]  && echo "tsconfig.base.json")

ln -sf "$ARCHIVE" "$BACKUPS_DIR/latest_code.tar.gz"

SIZE=$(du -sh "$ARCHIVE" | cut -f1)

echo "    Done"
echo ""
echo "============================================"
echo "  ✅ Code backup complete!"
echo "     File : backups/code_$TIMESTAMP.tar.gz"
echo "     Size : $SIZE"
echo "============================================"
