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

- [ ] Public domains stay on the Coming Soon project until launch:
  - `truefantix.com`
  - `www.truefantix.com`
  - `truefantix.ca`
  - `www.truefantix.ca`
- [ ] Dev project `truefantix-web` must not own public `.com` or `.ca` domains.
- [ ] Vercel Root Directory remains `truefantix-web`.
- [ ] Dev project does not set `COMING_SOON_MODE=1`.
- [ ] Coming Soon lock enforcement remains in `src/proxy.ts`, not `middleware.ts`.

## Required Env Vars

Set or verify these in Vercel for `truefantix-web` before release testing.

- [ ] `PASSWORD_RESET_SECRET` is set and at least 32 characters.
- [ ] `CRON_SECRET` is set if using cron header auth.
- [ ] `APP_ORIGIN` is set to the exact app origin, for example `https://truefantix-web.vercel.app` for dev.
- [ ] `STRIPE_WEBHOOK_SECRET` matches the Stripe webhook endpoint secret.
- [ ] `UPSTASH_REDIS_REST_URL` is set for durable Vercel rate limiting.
- [ ] `UPSTASH_REDIS_REST_TOKEN` is set with the matching Upstash token.
- [ ] `TWILIO_ACCOUNT_SID` is set.
- [ ] `TWILIO_AUTH_TOKEN` is set.
- [ ] `TWILIO_PHONE_NUMBER` is set in E.164 format, for example `+14165550123`.

## Verification Gates

- [ ] Redeploy `truefantix-web` after env changes.
- [ ] `GET https://truefantix-web.vercel.app/api/health` returns `200` and `status: healthy`.
- [ ] `GET https://truefantix-web.vercel.app/api/health/verification` returns `200` and `status: healthy`.
- [ ] Unsigned `POST /api/webhooks/stripe` returns a controlled `400 MISSING_SIGNATURE`.
- [ ] Protected admin/account endpoints return controlled `401` or `403` when unauthenticated.
- [ ] Password reset flow works with configured `PASSWORD_RESET_SECRET`.
- [ ] Phone verification flow sends through Twilio and no longer falls back to dev logging.
- [ ] Stripe webhook duplicate delivery replay does not double-process an order.

## QA Before Dev-To-Main Promotion

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Manual auth flow passes: register, verify email/phone, login, forgot/reset password.
- [ ] Manual seller flow passes: onboarding state, create listing, listing appears in account.
- [ ] Manual buyer flow passes: browse ticket, initialize purchase, Stripe checkout form renders.
- [ ] Manual community flow passes: create thread, reply, validation errors render clearly.
- [ ] No new regressions appear in dev logs.
- [ ] Team signs off.

## Public Coming Soon Validation

Run this before and after any `dev` to `main` promotion.

- [ ] `https://www.truefantix.com/` shows Coming Soon.
- [ ] `https://www.truefantix.com/login` does not expose the full app.
- [ ] Early access signup inserts a row in `EarlyAccessLead`.
- [ ] DNS still points as expected:
  - Apex records to `76.76.21.21`
  - `www` CNAME records to `cname.vercel-dns.com`

## References

- `docs/RUNBOOK_DEPLOYMENT_DEV_VS_COMING_SOON_ONEPAGER.md`
- `docs/dev-qa-checklist-2026-03-17.md`
- `docs/security-hardening-2026-03.md`
- `TESTING.md`
