#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web"
temp_dir="$(mktemp -d)"
cleanup() {
  rm -f "$temp_dir/production.env" "$temp_dir/response.json"
  rmdir "$temp_dir" 2>/dev/null || true
}
trap cleanup EXIT

cd "$app_dir"
HOME=/home/marc npx vercel env pull "$temp_dir/production.env" --environment=production --yes >/dev/null
set -a
# shellcheck disable=SC1090
source "$temp_dir/production.env"
set +a

status="$(curl --silent --show-error --output "$temp_dir/response.json" --write-out '%{http_code}' \
  --request POST \
  --header "Authorization: Bearer $CRON_SECRET" \
  https://truefantix.ca/api/cron/outreach-gmail-sync)"
if [[ "$status" != "200" ]] || ! grep -q '"ok":true' "$temp_dir/response.json"; then
  echo "Gmail reply sync failed with HTTP $status" >&2
  exit 1
fi

grep -o '"matched":[0-9]*\|"ignored":[0-9]*\|"duplicates":[0-9]*' "$temp_dir/response.json" | tr '\n' ' '
echo
