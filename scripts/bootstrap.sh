#!/usr/bin/env bash
# One-command local setup for a fresh machine or a new AI session:
#   deps → Docker → local Supabase → .env.local → migrations + seed.
# Safe to re-run. Usage: bash scripts/bootstrap.sh [--no-seed]
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

say "Installing dependencies"
pnpm install --frozen-lockfile

say "Checking Docker"
if ! docker info >/dev/null 2>&1; then
  if command -v dockerd >/dev/null 2>&1; then
    (dockerd >/tmp/dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
fi
docker info >/dev/null 2>&1 || { echo "Docker is not running — start Docker and re-run."; exit 1; }

say "Starting local Supabase"
if ! supabase status >/dev/null 2>&1; then
  # Some sandboxes block ghcr.io / ECR; Docker Hub mirrors the same images.
  pnpm db:start || SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io pnpm db:start
fi

say "Writing .env.local from supabase status"
eval "$(supabase status -o env | grep -E '^(API_URL|DB_URL|PUBLISHABLE_KEY|SECRET_KEY)=')"
cat > .env.local <<EOF
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}
SUPABASE_SECRET_KEY=${SECRET_KEY}
DATABASE_URL=${DB_URL}
EMAIL_PROVIDER=smtp
EMAIL_FROM="Central <no-reply@central.demo.local>"
SMTP_HOST=127.0.0.1
SMTP_PORT=54325
EOF

if [[ "${1:-}" != "--no-seed" ]]; then
  say "Resetting database (migrations + seed)"
  pnpm db:reset
fi

say "Ready"
echo "  pnpm dev            → http://localhost:3000   (all seed passwords: Passw0rd!)"
echo "  Mailpit             → http://localhost:54324"
echo "  pnpm check && pnpm test:db && pnpm test:e2e"
echo "  (If Playwright's browser is missing: PW_CHROMIUM_PATH=/path/to/chromium pnpm test:e2e)"
