#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web"
temp_dir="$(mktemp -d)"
cleanup() {
  rm -f "$temp_dir/production.env"
  rmdir "$temp_dir" 2>/dev/null || true
}
trap cleanup EXIT

cd "$app_dir"
HOME=/home/marc npx vercel env pull "$temp_dir/production.env" --environment=production --yes >/dev/null
set -a
# shellcheck disable=SC1090
source "$temp_dir/production.env"
set +a

export NODE_ENV=production
export DATABASE_URL="postgresql://truefantix_mirror@127.0.0.1:55432/truefantix_mirror"
export APP_ORIGIN="http://127.0.0.1:3100"
export NEXT_PUBLIC_APP_URL="http://127.0.0.1:3100"
exec npm start -- -H 127.0.0.1 -p 3100
