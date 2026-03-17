# Dev QA Checklist — 2026-03-17

Environment: `https://truefantix-web.vercel.app`
Branch baseline: `dev`

## Scope
Validation hardening + error contract alignment + frontend details-aware messages.

---

## A) Automated/API checks (completed)

### Platform health
- [x] `GET /api/health` returns healthy
- [x] `GET /api/auth/csrf` returns csrf token

### Validation contract checks (live)
- [x] `POST /api/orders/checkout` invalid payload -> `400 VALIDATION_ERROR`
- [x] `POST /api/auth/register` invalid payload -> `400 VALIDATION_ERROR`
- [x] `POST /api/auth/forgot-password` bad email -> `400 VALIDATION_ERROR`
- [x] `POST /api/payments/create-intent` protected (unauth -> `401/403`)
- [x] `POST /api/tickets/:id/purchase` protected (unauth -> `401/403`)

### Test suites added and passing
- [x] `src/__tests__/validation.helpers.test.ts`
- [x] `src/__tests__/validation.schemas.highrisk.test.ts`
- [x] `src/__tests__/api.live.integration.test.ts`

---

## B) Manual UI happy-path checks (to run in browser)

> These require interactive browser/session test users and were not fully executable via headless API-only checks.

### Auth flow
- [ ] Register new user from `/register`
- [ ] Verify email + phone flow from `/verify`
- [ ] Login from `/login`
- [ ] Forgot password + reset flow (`/forgot-password` -> `/reset-password`)

### Seller flow
- [ ] Seller onboarding/approval state visible in account
- [ ] Create ticket listing from `/account/tickets/selling`
- [ ] Confirm listing appears in "My active listings"

### Buyer flow
- [ ] Browse/select ticket
- [ ] Purchase/checkout initializes order + payment intent
- [ ] Checkout page renders Stripe form without validation regressions

### Community flow
- [ ] Create forum thread (`/forum/new`)
- [ ] Post a reply in thread
- [ ] Verify validation error messages render clearly when body/title invalid

### Messaging + review flow
- [ ] Send message in a conversation
- [ ] Submit review after eligible order

---

## C) QA notes

- API validation/error contract behavior is now standardized and documented in:
  - `docs/api-validation.md`
- Frontend key forms now surface `details[0]` where available, then fallback to `message/error`.

---

## D) Exit criteria for dev -> main promotion

- [ ] All Manual UI happy-path checks in section B pass
- [ ] No new regressions in dev logs
- [ ] Team sign-off

If all pass, proceed with controlled promotion PR from `dev` -> `main`.
