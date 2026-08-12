# TrueFanTix Launch Operations Runbook

## Current verified state (2026-08-12)

- Vercel Production contains Stripe secret, publishable, and webhook variables, but the API and publishable keys are **test mode**. Do not call this live-ready.
- Application Stripe handlers cover `payment_intent.succeeded`, `payment_intent.payment_failed`, and `charge.refunded`.
- Sentry SDK support is installed but remains disabled until `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are configured. `SENTRY_AUTH_TOKEN` is optional and enables production source-map upload.
- `/api/health/reminder-scheduler` becomes healthy after the first newly instrumented reminder run and becomes stale after seven hours without a successful run.

## Stripe live-mode gate

Account owner must confirm in Stripe live mode:

1. Platform account and Connect are approved with no outstanding requirements.
2. A dedicated live webhook points to `https://www.truefantix.com/api/webhooks/stripe` and subscribes to `payment_intent.succeeded`, `payment_intent.payment_failed`, and `charge.refunded`.
3. Connect operational alerts also cover `account.updated`, `account.external_account.updated`, `payout.failed`, and `balance.available`. These are monitoring events; do not silently treat them as order state transitions.
4. Canadian CAD and USD bank accounts/currencies are configured as intended. Run separate low-value CAD and USD live purchases and payouts and preserve the Stripe IDs in the launch evidence log.
5. Only after those tests pass, replace Vercel Production with `sk_live_...`, `pk_live_...`, and the live endpoint's `whsec_...`, then redeploy.
6. Reconcile the legacy US$80 payout independently. It is not launch-test evidence.

## Monitoring and uptime

Configure Sentry Production variables, redeploy, then deliberately generate one controlled test exception and confirm issue ingestion and source-map symbolication. Create alerts for new fatal errors, repeated `/api/webhooks/stripe` failures, and database/Prisma error spikes.

Configure an external service to check every five minutes:

- `GET /`
- `GET /api/health`
- `GET /api/health/reminder-scheduler`

The external scheduler fallback may call `POST /api/cron/order-transfer-reminders` with `Authorization: Bearer <CRON_SECRET>` shortly after each six-hour boundary. The endpoint is idempotent within reminder windows.

## Backup and restore drill

1. Confirm Neon automated-backup retention and point-in-time recovery for the production branch.
2. Create a fresh manual snapshot/export without overwriting production.
3. Restore to a separate isolated Neon project/branch.
4. Point a local or Preview-only deployment at the restored database and verify row counts for users, tickets, orders, payments, payouts, and delivery/audit records.
5. Record start/end time, recovery point, object counts, errors, and cleanup owner.
6. Export an inventory of Vercel variable names (never secret values), Stripe webhook endpoint/event configuration, and scheduler secret rotation steps.

## Manual release QA and sign-off

Run desktop and mobile QA for registration, email/phone verification, login/logout, password reset, seller onboarding, listing, CAD/USD checkout, transfer proof, buyer confirmation/dispute, community posting, Admin queues, keyboard navigation, focus visibility, labels, contrast, and every customer email/link. Review Vercel, Sentry, Stripe, email, SMS, and reminder delivery logs immediately afterward.

Business owner and counsel must explicitly approve Terms, Privacy, refund/dispute policy, payout timing, tax treatment, support contact, incident/refund procedure, and urgent Admin-queue ownership before public payment acceptance.

## Launch cutover (requires Marc's explicit authorization)

Move `.com` and `.ca` from Coming Soon only after all gates pass. Set `APP_ORIGIN`, `NEXT_PUBLIC_APP_URL`, and allowed origins to `https://www.truefantix.com`; attach the live Stripe webhook; redeploy; request fresh verification/reset messages; and complete health, auth, checkout-boundary, webhook-signature, and scheduler smoke checks.
