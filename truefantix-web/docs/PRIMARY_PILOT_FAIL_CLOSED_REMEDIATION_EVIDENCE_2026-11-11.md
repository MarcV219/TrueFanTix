# Primary Pilot fail-closed remediation evidence — 2026-11-11

Scope is the isolated branch `fix/primary-pilot-fail-closed`. No deployment, Preview mutation, Stripe request, live-data operation, or gate opening occurred.

## Hash binding

- Base pilot commit: `2536419040d6356a49c4f26d5ddd0f2565c6a5f0`
- PT-01 remediation commit: `e6d1c15d69d991f7567205f7b019bdb79305f37f`
- PT-02/PT-03/PT-04/PT-05 remediation commit: `6a602275651d0805dee25e49ef4f97f5cf404e6d`
- Boundary/race evidence commit: `0818126845d7c7e87fabd4e2f6e2441d913090c1`

## Outcomes

| Control | Evidence | Result |
| --- | --- | --- |
| PT-01 stale checkout replay | Active/unexpired and paid/succeeded replay; cancelled and expired typed rejection; no-write assertions | PASS |
| PT-02 success webhook binding | Exact intent, amount, currency, order status, reservation ownership, and expiry fixtures; every mismatch returns conflict before writes | PASS |
| PT-03 stale failed webhook | Success state followed by stale/foreign failure; zero order/payment/ticket release writes | PASS |
| PT-04 expiry boundary/race | `-1ms`, exact boundary, `+1ms`; inclusive `<=` rule; order/ticket row locks; release only after winning the atomic pending-order cancellation | PASS |
| PT-05 Preview/token mutation gate | Absent/false approval refuses capability; explicit isolated Preview + configured token + approval is required before Primary mutation handlers | PASS (offline/runtime boundary) |

## Verification receipt

Branch-local Prisma Client generated from this branch's schema using a non-routable synthetic PostgreSQL URL. No database connection was made.

```text
npm run typecheck
PASS (tsc --noEmit)

npm test -- --runInBand \
  src/__tests__/reservation-expiry-route.test.ts \
  src/__tests__/reservation-expiry.test.ts \
  src/__tests__/stripe-webhook-route.test.ts \
  src/__tests__/checkout-race.test.ts \
  src/__tests__/primary-staging-console.test.ts \
  src/__tests__/primary-pilot-boundaries.test.ts

Test Suites: 6 passed, 6 total
Tests: 57 passed, 57 total
```

Scoped ESLint completed with zero errors. Existing `no-explicit-any` warnings remain in legacy route/test code and did not open any gate.

## Gate decision

Code remediation is complete at the bound commit above. Operational status remains **NO-GO / CLOSED** until this evidence is independently reviewed and Marc explicitly approves both isolated Preview configuration and staging mutation-token access. This document does not authorize deployment or testing against Preview.
