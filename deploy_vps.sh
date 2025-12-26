#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-connect-hub-main}"
WEB_ROOT="${WEB_ROOT:-/var/www/nexuschat}"
ENV_FILE="${ENV_FILE:-.env.local}"

cd "$REPO_ROOT/$APP_DIR"

if [ ! -f package.json ]; then
  echo "package.json not found in $APP_DIR. Check APP_DIR." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE in $APP_DIR. Create it with VITE_* values." >&2
  exit 1
fi

required_vars=(VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY)
for key in "${required_vars[@]}"; do
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "Missing ${key} in ${ENV_FILE}." >&2
    exit 1
  fi
done

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

npm run build

if [ ! -d "$WEB_ROOT" ]; then
  echo "WEB_ROOT not found: $WEB_ROOT" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

$SUDO rsync -av --delete dist/ "$WEB_ROOT"/

if command -v nginx >/dev/null 2>&1; then
  $SUDO nginx -t
  $SUDO systemctl reload nginx
fi

echo "Deploy complete."
