#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════╗"
echo "║   SMC Crypto Monitor — Fresh Account Setup  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "This script sets up everything on a brand new Replit account."
echo "Run it once after uploading your backup archive."
echo ""

# ── Step 1: Check required environment ───────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " STEP 1 — Checking environment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

MISSING=0

if [ -z "$DATABASE_URL" ]; then
  echo " ❌ DATABASE_URL  — NOT SET"
  echo "    → In Replit: go to Tools → Database → click 'Create Database'"
  echo "      Then come back and run this script again."
  MISSING=1
else
  echo " ✅ DATABASE_URL  — set"
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo " ⚠️  TELEGRAM_BOT_TOKEN — NOT SET"
  echo "    → In Replit: go to Tools → Secrets → add TELEGRAM_BOT_TOKEN"
  echo "      (Bot will not send alerts until this is set)"
else
  echo " ✅ TELEGRAM_BOT_TOKEN — set"
fi

if [ -z "$TELEGRAM_CHAT_ID" ]; then
  echo " ⚠️  TELEGRAM_CHAT_ID — NOT SET"
  echo "    → In Replit: go to Tools → Secrets → add TELEGRAM_CHAT_ID"
  echo "      Your chat ID is: 5851227801"
else
  echo " ✅ TELEGRAM_CHAT_ID — ${TELEGRAM_CHAT_ID}"
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo " ⛔ Cannot continue without DATABASE_URL."
  echo "    Set it up in Replit and re-run this script."
  exit 1
fi

echo ""

# ── Step 2: Install pnpm if missing ──────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " STEP 2 — Installing package manager"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v pnpm &>/dev/null; then
  echo " Installing pnpm..."
  npm install -g pnpm
  echo " ✅ pnpm installed"
else
  echo " ✅ pnpm $(pnpm --version) already installed"
fi

echo ""

# ── Step 3: Install dependencies ─────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " STEP 3 — Installing dependencies"
echo "          (this takes 1-2 minutes, please wait)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$ROOT"
pnpm install
echo " ✅ Dependencies installed"
echo ""

# ── Step 4: Set up database schema ───────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " STEP 4 — Setting up database (fresh tables)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$ROOT/lib/db"
npx drizzle-kit push --force 2>/dev/null || npx drizzle-kit push
cd "$ROOT"

TABLES=$(psql "$DATABASE_URL" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' ')
echo " ✅ Database ready — $TABLES tables created"
echo ""

# ── Step 5: Build API server ──────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " STEP 5 — Building API server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$ROOT"
pnpm --filter @workspace/api-server run build
echo " ✅ API server built"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════╗"
echo "║              ✅  SETUP COMPLETE!             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo " Your bot is ready. Start it with:"
echo ""
echo "   API + Bot:"
echo "   pnpm --filter @workspace/api-server run dev"
echo ""
echo "   Dashboard:"
echo "   pnpm --filter @workspace/dashboard run dev"
echo ""

# Warn about missing secrets
if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " ⚠️  SECRETS STILL NEEDED before alerts work:"
  [ -z "$TELEGRAM_BOT_TOKEN" ] && echo "    → TELEGRAM_BOT_TOKEN = <your bot token from BotFather>"
  [ -z "$TELEGRAM_CHAT_ID"   ] && echo "    → TELEGRAM_CHAT_ID   = 5851227801"
  echo " Add them in: Replit Tools → Secrets"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

echo ""
