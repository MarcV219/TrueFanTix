#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TFT_BASE_URL:-http://localhost:3000}"
VERIFY_KEY="${TICKET_VERIFY_CRON_KEY:-}"
TAKE="${TFT_VERIFY_TAKE:-50}"

if [[ -z "$VERIFY_KEY" ]]; then
  echo "ERROR: TICKET_VERIFY_CRON_KEY is not set"
  exit 1
fi

curl -fsS -X POST "${BASE_URL}/api/tickets/verify/pending" \
  -H "Content-Type: application/json" \
  -H "x-ticket-verify-key: ${VERIFY_KEY}" \
  -d "{\"take\": ${TAKE}}"
