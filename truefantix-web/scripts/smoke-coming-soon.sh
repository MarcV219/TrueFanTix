#!/usr/bin/env bash
set -euo pipefail

# Smoke test for TrueFanTix Coming Soon lockdown behavior.
#
# Usage:
#   ./scripts/smoke-coming-soon.sh
#   ./scripts/smoke-coming-soon.sh https://www.truefantix.com

BASE_URL="${1:-https://www.truefantix.com}"
BASE_URL="${BASE_URL%/}"

pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; exit 1; }

fetch_headers() {
  local path="$1"
  curl -sSI "${BASE_URL}${path}"
}

header_value() {
  local headers="$1"
  local key="$2"
  # case-insensitive header lookup, strip CR
  echo "$headers" | tr -d '\r' | awk -F': ' -v k="$(echo "$key" | tr '[:upper:]' '[:lower:]')" 'tolower($1)==k {print $2}' | tail -n1
}

status_code() {
  local headers="$1"
  echo "$headers" | tr -d '\r' | awk 'toupper($1) ~ /^HTTP\// {code=$2} END{print code}'
}

# 1) / should be reachable and return 200
root_headers="$(fetch_headers "/")"
root_status="$(status_code "$root_headers")"
[[ "$root_status" == "200" ]] || fail "Expected / status 200, got ${root_status}"
pass "/ returns 200"

# 2) /login should redirect to /
login_headers="$(fetch_headers "/login")"
login_status="$(status_code "$login_headers")"
login_location="$(header_value "$login_headers" "location")"

case "$login_status" in
  301|302|307|308) ;;
  *) fail "Expected /login redirect status (301/302/307/308), got ${login_status}" ;;
esac

if [[ "$login_location" != "/" && "$login_location" != "${BASE_URL}/" ]]; then
  fail "Expected /login to redirect to /, got location: ${login_location:-<none>}"
fi
pass "/login redirects to /"

# 3) /foo should redirect to /
foo_headers="$(fetch_headers "/foo")"
foo_status="$(status_code "$foo_headers")"
foo_location="$(header_value "$foo_headers" "location")"

case "$foo_status" in
  301|302|307|308) ;;
  *) fail "Expected /foo redirect status (301/302/307/308), got ${foo_status}" ;;
esac

if [[ "$foo_location" != "/" && "$foo_location" != "${BASE_URL}/" ]]; then
  fail "Expected /foo to redirect to /, got location: ${foo_location:-<none>}"
fi
pass "/foo redirects to /"

echo "🎉 Coming Soon smoke test passed for ${BASE_URL}"
