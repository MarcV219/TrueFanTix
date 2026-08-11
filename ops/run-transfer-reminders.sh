#!/usr/bin/env bash
set -euo pipefail

environment_file="${1:-}"
if [[ -z "$environment_file" || ! -r "$environment_file" ]]; then
  echo "Readable Vercel environment file is required." >&2
  exit 2
fi

set -a
# Vercel CLI writes a shell-compatible environment file.
# shellcheck disable=SC1090
source "$environment_file"
set +a

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "CRON_SECRET is missing." >&2
  exit 2
fi

app_url="${TRUEFANTIX_APP_URL:-${APP_ORIGIN:-https://truefantix-web.vercel.app}}"
app_url="${app_url%/}"

curl \
  --fail-with-body \
  --silent \
  --show-error \
  --retry 5 \
  --retry-all-errors \
  --retry-delay 15 \
  --max-time 90 \
  --request POST \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  "${app_url}/api/cron/order-transfer-reminders"
