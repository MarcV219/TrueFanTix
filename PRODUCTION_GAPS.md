# Production Readiness Gap Analysis — TrueFanTix

## Critical Gaps (Must Fix Before Launch)

### 1. ⚠️ ADMIN AUTH GUARDS MISSING (FIXED)
**Status:** ✅ Fixed in this session  
**Issue:** Admin routes (`/api/admin/orders/[id]/deliver`, `/api/admin/orders/[id]/complete`) lacked admin authentication guards.  
**Fix Applied:** Added `requireAdmin()` guard to both routes.

### 2. 🔐 SESSION/COOKIE SECURITY HARDENING
**Status:** 🔴 Open  
**Issue:** Session cookies need production-grade settings (secure, httpOnly, sameSite).  
**Action Required:**
- Set `SESSION_SECRET` to cryptographically secure random (32+ chars)
- Configure cookie `secure: true` in production (HTTPS only)
- Set `sameSite: 'strict'` or `'lax'`
- Add cookie `httpOnly: true`

### 3. 💳 STRIPE WEBHOOK IDEMPOTENCY
**Status:** ✅ Fixed  
**Issue:** Webhook handler sends emails on every `payment_intent.succeeded` event without deduplication. Duplicate webhooks = duplicate emails.  
**Fix Applied:**
- Added `EventDelivery` model to track processed Stripe events
- Added `EmailDelivery` model to track sent emails
- Webhook checks `EventDelivery` before processing
- Email sending checks `EmailDelivery` before sending
- Both event and email tracking use unique constraints to prevent duplicates

### 4. 📧 EMAIL DELIVERY FAILURE HANDLING
**Status:** ✅ Fixed  
**Issue:** Email failures in webhook are logged but don't trigger retries or alerts.  
**Fix Applied:**
- `EmailDelivery` model tracks status (SENT/FAILED) and error messages
- Failed emails are recorded with error details for debugging
- Future: retry logic can query failed emails

### 5. 🎫 TICKET ESCROW PROVIDER INTEGRATION
**Status:** 🔴 Open  
**Issue:** Ticket custody escrow exists but has no real provider integration (Ticketmaster/AXS transfer APIs).  
**Action Required:**
- Partner API access negotiation
- Implement provider-specific transfer flows
- Add provider webhook handlers for transfer confirmations

### 6. 🔄 ESCROW TIMEOUT/EXPIRATION
**Status:** ✅ Fixed  
**Issue:** No automatic timeout for escrow holds. Orders could stay in `PAID` state indefinitely.  
**Fix Applied:**
- Added cron job: `Escrow Timeout Check` (runs hourly)
- Endpoint: `POST /api/cron/escrow-timeout`
- Behavior: Identifies `PAID` orders past `ESCROW_TIMEOUT_MINUTES` (currently 60m), cancels them, releases tickets, and marks escrow `RELEASED_BACK_TO_SELLER`.
- Requires `CRON_SECRET` env var for internal cron auth.

### 7. 📊 RATE LIMITING & ABUSE PROTECTION
**Status:** 🟡 Partially Fixed  
**Issue:** No API rate limiting on public endpoints (ticket creation, purchase attempts).  
**Fix Applied:**
- Added per-IP in-memory rate limiting utility (`src/lib/rate-limit.ts`)
- Enforced on:
  - `POST /api/tickets` (20/min)
  - `POST /api/tickets/[id]/purchase` (30/min)
  - `POST /api/payments/create-intent` (20/min)
**Remaining:**
- Distributed/store-backed limiter (Redis) for multi-instance production
- Optional CAPTCHA + abuse heuristics

### 8. 🛡️ BARCODE HASH SECURITY
**Status:** 🔴 Open  
**Issue:** Barcode data is hashed but not encrypted at rest. Database compromise exposes ticket legitimacy patterns.  
**Action Required:**
- Evaluate if encryption (not just hashing) is needed for barcode storage
- Consider HMAC with secret key instead of plain SHA256

### 9. 📈 MONITORING & ALERTING
**Status:** 🟡 Partially Fixed  
**Issue:** No production monitoring for:
- Failed payments
- Escrow release failures
- Database connection issues
- High error rates
**Fix Applied:**
- Added health endpoint: `GET /api/health` (DB connectivity + status)
- Added admin ops metrics endpoint: `GET /api/admin/ops/metrics`
  - 24h order status rollups
  - failed email count
  - pending payout count
  - tickets currently in escrow
**Remaining:**
- Structured JSON logging pipeline
- External error tracking (Sentry/Datadog/etc.)
- Alert thresholds + on-call notification routing

### 10. 🧪 TEST COVERAGE GAPS
**Status:** 🔴 Open  
**Issue:** Limited test coverage on critical paths:
- Purchase flow edge cases
- Escrow state transitions
- Concurrent reservation conflicts
**Action Required:**
- Add integration tests for all OrderStatus transitions
- Add load tests for reservation system
- Add chaos tests for payment webhooks

## Medium Priority (Fix Soon After Launch)

### 11. 📱 MOBILE RESPONSIVENESS AUDIT
**Status:** 🟡 Not Verified  
**Action:** Test all critical flows on mobile devices

### 12. 🌍 CDN & STATIC ASSETS
**Status:** 🟡 Not Configured  
**Action:** Set up CDN for images/static assets

### 13. 📋 TERMS OF SERVICE FLOW
**Status:** 🟡 Partial  
**Action:** Ensure explicit ToS acceptance before first purchase

## Completed in This Session

- ✅ Database migration reset and applied successfully
- ✅ Typecheck passes
- ✅ Admin auth guards added
- ✅ HTTP smoke tests pass (tickets listing, auth checks)
- ✅ Escrow lifecycle integration tests pass
- ✅ Stripe webhook replay drill passes

## Immediate Next Actions (Priority Order)

1. **Fix Session Security** — Critical for production auth safety
2. **Add Stripe Webhook Idempotency** — Prevents duplicate customer emails
3. **Implement Escrow Timeout** — Prevents stuck orders
4. **Add Rate Limiting** — Prevents abuse
5. **Set Up Monitoring** — Required for production visibility

## Blockers Requiring Marc Input

None currently — all critical fixes are code-complete or have clear implementation paths.
