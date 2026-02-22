#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TFT_BASE_URL:-http://localhost:3010}"
DB_PATH="${TFT_DB_PATH:-/home/marc/.openclaw/workspace/truefantix-web/prisma/dev.db}"
SESSION_TOKEN="${TFT_SESSION_TOKEN:-}"

if [[ -z "$SESSION_TOKEN" ]]; then
  echo "ERROR: TFT_SESSION_TOKEN is required"
  exit 1
fi

echo "[1/5] Admin verification count"
curl -fsS "$BASE_URL/api/admin/tickets/verification-count" \
  -H "Cookie: tft_session=$SESSION_TOKEN" | jq '{ok,counts}'

TS=$(date +%s)
BAR="SMOKE-BAR-$TS"
BODY=$(jq -n \
  --arg t "HTTP Smoke $TS" \
  --arg v "Smoke Venue" \
  --arg d "2026-12-31 8:00 PM" \
  --arg i "https://example.com/smoke.jpg" \
  --arg b "$BAR" \
  '{title:$t,venue:$v,date:$d,image:$i,priceCents:12345,faceValueCents:12345,barcodeData:$b,barcodeType:"QR"}')

echo "[2/5] Create ticket with barcode evidence"
RESP=$(curl -fsS -X POST "$BASE_URL/api/tickets" \
  -H 'Content-Type: application/json' \
  -H "Cookie: tft_session=$SESSION_TOKEN" \
  -d "$BODY")

echo "$RESP" | jq '{ok,ticket:(.ticket // .data?.ticket // .ticket?.ticket)}'
TICKET_ID=$(echo "$RESP" | jq -r '.ticket.id // .data.ticket.id // .ticket.ticket.id // empty')

if [[ -z "$TICKET_ID" || "$TICKET_ID" == "null" ]]; then
  echo "ERROR: ticket id missing from create response"
  echo "$RESP" | jq '.'
  exit 1
fi

echo "[3/5] Duplicate barcode must fail with 409"
HTTP_CODE=$(curl -sS -o /tmp/tft-smoke-dup.json -w "%{http_code}" -X POST "$BASE_URL/api/tickets" \
  -H 'Content-Type: application/json' \
  -H "Cookie: tft_session=$SESSION_TOKEN" \
  -d "$BODY")

echo "duplicate_status=$HTTP_CODE"
cat /tmp/tft-smoke-dup.json | jq '{ok,error,message}'

if [[ "$HTTP_CODE" != "409" ]]; then
  echo "ERROR: expected duplicate request to return 409"
  exit 1
fi

echo "[4/5] Queue lookup should include created ticket"
curl -fsS "$BASE_URL/api/admin/tickets/verification-queue?status=VERIFIED&take=100" \
  -H "Cookie: tft_session=$SESSION_TOKEN" | \
  jq --arg id "$TICKET_ID" '{ok,found:([.tickets[]|select(.id==$id)]|length),sample:([.tickets[]|select(.id==$id)][0]|{id,verificationStatus,verificationScore,barcodeType,barcodeLast4})}'

echo "[5/5] Cleanup test ticket"
sqlite3 "$DB_PATH" "DELETE FROM Ticket WHERE id='$TICKET_ID';"

echo "Smoke test complete ✅"
