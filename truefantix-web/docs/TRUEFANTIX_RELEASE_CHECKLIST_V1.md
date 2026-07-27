# TrueFanTix Release Checklist V1

Use this checklist before promoting the dev app toward a public launch. It combines the current deployment runbook with the active launch-blocker env checks.

## Source Of Truth

- Canonical repo: `MarcV219/TrueFanTix`
- Local app root: `/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web`
- Next.js app root in repo: `truefantix-web/`
- Dev project: `truefantix-web`
- Dev URL: `https://truefantix-web.vercel.app`
- Public Coming Soon project: `true-fan-tix-coming-soon`

## Do Not Break

- [x] Public domains stay on the Coming Soon project until launch:
  - `truefantix.com`
  - `www.truefantix.com`
  - `truefantix.ca`
  - `www.truefantix.ca`
- [x] Dev project `truefantix-web` must not own public `.com` or `.ca` domains.
- [x] Vercel Root Directory remains `truefantix-web`.
- [x] Dev project does not set `COMING_SOON_MODE=1`.
- [x] Coming Soon lock enforcement remains in `src/proxy.ts`, not `middleware.ts`.

## Required Env Vars

Set or verify these in Vercel for `truefantix-web` before release testing.

- [x] `PASSWORD_RESET_SECRET` is set and at least 32 characters.
- [x] `CRON_SECRET` is set if using cron header auth.
- [x] `APP_ORIGIN` is set to the exact app origin, for example `https://truefantix-web.vercel.app` for dev.
- [ ] Stripe mode matches the current testing stage:
  - Pre-launch QA on `https://truefantix-web.vercel.app`: use sandbox/test Stripe keys (`STRIPE_SECRET_KEY=sk_test_...`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`) and the sandbox webhook signing secret (`STRIPE_WEBHOOK_SECRET=whsec_...`) for `https://truefantix-web.vercel.app/api/webhooks/stripe`.
  - Public launch: switch deliberately to live Stripe keys (`sk_live_...`, `pk_live_...`) only after live Connect setup, account verification, and live webhook setup are complete.
- [x] `UPSTASH_REDIS_REST_URL` is set for durable Vercel rate limiting.
- [x] `UPSTASH_REDIS_REST_TOKEN` is set with the matching Upstash token.
- [x] `TWILIO_ACCOUNT_SID` is set.
- [x] `TWILIO_AUTH_TOKEN` is set.
- [x] `TWILIO_PHONE_NUMBER` is set in E.164 format, for example `+14165550123`.

## Scheduled Jobs

- [x] GitHub repo secret `CRON_SECRET` is set to the same value as Vercel `CRON_SECRET`.
- [ ] Optional GitHub repo variable `TRUEFANTIX_APP_URL` points at the launch app origin; if omitted, the scheduler uses `https://truefantix-web.vercel.app`.
- [x] GitHub Actions workflow `Transfer reminders` has been run manually once and returns `ok: true`.
- [x] Vercel Cron is not used for six-hour transfer reminders, keeping the Vercel Hobby plan viable.

## Launch Domain Cutover

Use this section when replacing the public Coming Soon page with the full app.

- [ ] Confirm final manual QA has passed on `https://truefantix-web.vercel.app`.
- [ ] Confirm team/public-launch approval.
- [ ] Attach public domains to the `truefantix-web` project:
  - `truefantix.com`
  - `www.truefantix.com`
  - `truefantix.ca`
  - `www.truefantix.ca`
- [ ] Remove those public domains from the `true-fan-tix-coming-soon` project if Vercel does not move them automatically.
- [ ] Keep `COMING_SOON_MODE` unset on `truefantix-web`.
- [ ] Update `truefantix-web` Production env:
  - `APP_ORIGIN=https://www.truefantix.com`
  - `NEXT_PUBLIC_APP_URL=https://www.truefantix.com`
  - `APP_ALLOWED_ORIGINS` includes `https://truefantix.com` and `https://www.truefantix.com`.
- [ ] Switch Stripe env from sandbox/test to live mode only after Stripe live Connect is ready:
  - `STRIPE_SECRET_KEY=sk_live_...`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...` from the live webhook endpoint.
- [ ] Redeploy `truefantix-web` after changing env vars.
- [ ] Update Stripe webhook endpoint to `https://www.truefantix.com/api/webhooks/stripe`.
- [ ] Set optional GitHub repo variable `TRUEFANTIX_APP_URL=https://www.truefantix.com` for transfer reminders.
- [ ] Request fresh email verification and forgot-password emails; old links can still contain the pre-cutover origin.
- [ ] Verify public app routes:
  - `https://www.truefantix.com/` shows the full app home page.
  - `https://www.truefantix.com/login` shows login, not Coming Soon.
  - `https://www.truefantix.com/reset-password?...` reaches the reset form from a fresh email link.
  - `GET https://www.truefantix.com/api/health` returns healthy.
  - `GET https://www.truefantix.com/api/health/verification` returns healthy.
  - Unsigned `POST https://www.truefantix.com/api/webhooks/stripe` returns controlled `400 MISSING_SIGNATURE`.

## Verification Gates

- [x] Redeploy `truefantix-web` after env changes.
- [x] `GET https://truefantix-web.vercel.app/api/health` returns `200` and `status: healthy`.
- [x] `GET https://truefantix-web.vercel.app/api/health/verification` returns `200` and `status: healthy`.
- [x] Unsigned `POST /api/webhooks/stripe` returns a controlled `400 MISSING_SIGNATURE`.
- [x] Protected admin/account endpoints return controlled `401` or `403` when unauthenticated.
- [ ] Password reset flow works with configured `PASSWORD_RESET_SECRET`.
- [x] Phone verification flow sends through Twilio and no longer falls back to dev logging.
- [x] Stripe webhook duplicate delivery replay does not double-process an order.

## QA Before Dev-To-Main Promotion

- [x] `npm run typecheck` passes.
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [ ] Manual auth flow passes: register, verify email/phone, login, forgot/reset password.
- [ ] Manual seller flow passes: onboarding state, create listing, listing appears in account.
- [ ] Seller Stripe onboarding only asks for information needed for individual payout recipients. New Express accounts should request `transfers` only, not `card_payments`, unless the payment flow changes to direct or destination charges.
- [ ] Manual buyer flow passes: browse ticket, initialize purchase, Stripe checkout form renders.
- [ ] Manual community flow passes: create thread, reply, validation errors render clearly.
- [ ] No new regressions appear in dev logs.
- [ ] Team signs off.

## Public Coming Soon Validation

Run this before and after any `dev` to `main` promotion.

- [x] `https://www.truefantix.com/` shows Coming Soon.
- [x] `https://www.truefantix.com/login` does not expose the full app.
- [ ] Early access signup inserts a row in `EarlyAccessLead`.
- [ ] DNS still points as expected:
  - Apex records to `76.76.21.21`
  - `www` CNAME records to `cname.vercel-dns.com`

## Status Notes

- 2026-05-28: Production profile phone updates and SMS verification were confirmed working after the missing `User` token/referral columns were added.
- 2026-05-28: Email verification send was confirmed working after the Resend key was corrected and production was redeployed.
- 2026-05-28: `truefantix.com` / `www.truefantix.com` are Cloudflare-proxied in DNS, while `truefantix.ca` resolves directly through Vercel DNS. Public `.com` route checks still show the Coming Soon lock.
- 2026-05-29: Production forum create, forgot-password, and emailed reset-link handling were fixed and deployed from `origin/dev` at `2e31d6a`; targeted reset-password Jest coverage and `npm run typecheck` pass.

## References

- `docs/RUNBOOK_DEPLOYMENT_DEV_VS_COMING_SOON_ONEPAGER.md`
- `docs/dev-qa-checklist-2026-03-17.md`
- `docs/security-hardening-2026-03.md`
- `TESTING.md`
