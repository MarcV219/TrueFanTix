# Backup and Recovery Runbook

## Protection layers

- Neon is the production PostgreSQL provider. Confirm the project's current restore window in Neon Console > Project > Settings because retention is plan/account state and cannot be proven from a database connection string.
- `truefantix-db-backup.timer` creates a PostgreSQL 17 custom-format logical export nightly at 10:45 PM America/Toronto.
- Exports and SHA-256 files live in `/home/marc/.openclaw/backups/truefantix`, use owner-only permissions, and are retained locally for 14 days.
- The existing IDrive job runs nightly at 11:30 PM and includes `/home/marc/.openclaw`, copying exports off the MiniPC.

## Restore drill evidence — 2026-08-12

- Source: production Neon PostgreSQL 17, read-only `pg_dump`.
- Artifact: compressed custom-format dump plus SHA-256 checksum (14 MB at drill time).
- Target: temporary isolated PostgreSQL 17 database on the MiniPC; production was never a restore target.
- Result: checksum passed, restore completed, and all 18 migrations were present.
- Production/restored row counts matched exactly: User 4, Ticket 73, Order 11, Payment 9, Payout 6, EmailDelivery 59, ReminderDelivery 4, AuditLog 104, ProductionIncident 0.
- The temporary restore database was destroyed automatically after validation.

## Recovery procedure

1. Stop writes or place the app in maintenance mode if production is partially available.
2. Choose either a Neon point-in-time recovery point or the newest verified logical dump.
3. Restore into a new isolated database/branch—never over the damaged source.
4. Verify checksum, migration count, and critical table counts.
5. Point a Preview deployment at the recovered database and complete health, authentication, order, payment-history, and Admin smoke checks.
6. Promote the recovered connection only after approval, then redeploy and monitor incidents/webhooks.

## Configuration recovery inventory

- Vercel is the source for application environment variables. Inventory names with `vercel env ls production`; never store values in Git.
- Required launch groups: database/session, origin/allowed origins, Stripe keys/webhook secret, cron secret, email, SMS, Redis, catalog/OCR, and Spotify.
- Stripe recovery: recreate the endpoint URL, select the documented event types, place the new signing secret in Vercel, and redeploy before replaying events.
- Scheduler recovery: rotate `CRON_SECRET` in Vercel and GitHub together, update the MiniPC environment file, manually invoke the idempotent endpoint, and verify `/api/health/reminder-scheduler`.
- Source code and workflow configuration are in GitHub; public-domain DNS remains separately controlled and must not be changed during a database recovery unless explicitly required.
