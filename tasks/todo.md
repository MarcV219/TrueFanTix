# Active Task — 2026-02-22 (Nightly Orchestration + Validation + Escrow)

## Goal
Implement: (A) 9PM daily unfinished-asks sweep + dashboard update, (B) public-document validation coding, (C) escrow handling MVP.

## Status
- [x] Plan drafted
- [x] Plan confirmed by Marc
- [x] A) 9PM cron sweep created + verified
- [x] B) Public validation implementation complete + wired
- [x] C) Escrow MVP implementation complete + wired
- [x] Verification complete (typecheck/tests/log review)
- [x] Review notes posted

## Plan
1. Add nightly cron at 9PM America/Toronto for ask review + incomplete-task continuation + dashboard refresh.
2. Implement stronger public validation signals and wire into ticket create + purchase pre-check.
3. Implement escrow state service and APIs; ensure webhook/payment/order flow reflects funds-held-until-complete behavior.
4. Verify via typecheck and targeted route sanity checks.

## Progress Log
- Started implementation.

## Review / Results
- Added daily 9:00 PM cron: `Daily Ask Review + Completion Sweep` (America/Toronto).
- Implemented public-validation rules in `src/lib/tickets/provider.ts` and wired into ticket creation.
- Added purchase guard to block tickets that are verification-rejected.
- Implemented escrow state derivation (`src/lib/escrow.ts`) and read endpoint (`GET /api/orders/[id]/escrow`).
- Updated webhook behavior to keep successful payments in escrow hold (`Order.PAID`) until delivery/complete flow.
- Extended order completion to release escrow into pending payout record (`ESCROW_INTERNAL`).
- Verified with `npm run -s typecheck` (pass).
- Verified ticket validation flow with `npx -y tsx scripts/smoke-ticket-verification.mjs` (pass).
