# Primary Ticketing Foundation Implementation

**Branch:** `feat/primary-ticketing-foundation`

**Scope:** Section 13 narrow foundation only

**Status:** Ready for implementation review; disabled by default

## Implemented

- A server-only feature preflight that fails closed unless all of the following are true:
  - `PRIMARY_TICKETING_ENABLED=true`;
  - `NODE_ENV` is not `production`;
  - `PRIMARY_TICKETING_ENVIRONMENT_ID` is `isolated-test` or `isolated-preview`;
  - `PRIMARY_TICKETING_DATABASE_URL` exactly matches the process `DATABASE_URL`; and
  - the PostgreSQL database name explicitly identifies a primary-ticketing test or preview database.
- An unavailable-by-default `/api/primary/health` route. Disabled or unsafe configurations return the same `404 NOT_FOUND` response.
- Dedicated organizer, membership, invitation, minimal event identity, event-staff assignment, audit, and outbox models. They have no relation to secondary `Ticket`, `Order`, `Payment`, `Payout`, or `Seller` records.
- Composite tenant foreign keys prevent an event assignment or event audit record from crossing organizer boundaries.
- Deny-by-default organizer and event authorization services. Every tenant query includes `organizerId`; non-owner event access also requires an active assignment belonging to the same organizer.
- A transactional helper that writes a redacted audit record and idempotent outbox message through the caller's existing database transaction.

## Isolated environment contract

These variables are examples only; no credential or environment file is committed:

```dotenv
NODE_ENV=test
PRIMARY_TICKETING_ENABLED=true
PRIMARY_TICKETING_ENVIRONMENT_ID=isolated-test
DATABASE_URL=postgresql://<isolated-user>:<password>@<isolated-host>/primary_ticketing_test
PRIMARY_TICKETING_DATABASE_URL=postgresql://<isolated-user>:<password>@<isolated-host>/primary_ticketing_test
```

The migration must be applied only to a newly provisioned isolated database. It must not be run against production, the existing TrueFanTix development database, or a database containing real users or organizers.

## Verification procedure

1. Provision a disposable PostgreSQL database named to match the preflight rule, such as `primary_ticketing_test`.
2. Apply the repository's existing migrations to that empty database with `prisma migrate deploy`.
3. Apply `20260910123000_add_primary_ticketing_foundation` using the same command.
4. Run the focused primary tests, full test suite, TypeScript, lint, and production build without enabling the feature.
5. Verify a synthetic cross-organizer event assignment fails at the composite foreign key.
6. Destroy the disposable database after recording non-secret results.

## Verification results — 2026-09-10

- Prisma format, schema validation, and client generation: passed.
- Clean migration deployment: all 36 repository migrations applied successfully to a newly created local PostgreSQL 16 `primary_ticketing_test` database; `prisma migrate status` reported the schema up to date.
- Database tenant constraints: PostgreSQL rejected both a synthetic cross-organizer event assignment and a synthetic cross-organizer event audit.
- Focused foundation tests: 4 suites / 14 tests passed.
- Full regression tests: 55 suites / 337 tests passed.
- TypeScript: passed with no errors.
- Focused foundation lint: passed with no warnings or errors.
- Full lint: passed with 0 errors and 619 pre-existing warnings.
- Production build: passed with primary ticketing disabled and the disposable database supplied to the build environment.
- Diff whitespace validation: passed.

## Risks and open decisions

- The preflight depends on explicit environment configuration and database naming. Deployment configuration remains intentionally absent until an isolated preview is separately authorized.
- The event model is only an identity/tenancy shell required for staff assignments; event authoring and lifecycle fields are not included.
- Audit snapshots use a deliberately small allowlist. Each later domain must explicitly add safe fields rather than persisting arbitrary request objects.
- The outbox foundation stores delivery intent only. No dispatcher, email, webhook, or external side effect is implemented.
- Invitation acceptance, organizer workflows, and CRUD endpoints are not part of this milestone. Future acceptance must enforce authenticated ownership of the normalized verified email.

## Explicit exclusions

This implementation contains no inventory, reservation, checkout, Stripe, credential, QR, transfer, scan, refund, ledger, settlement, report, public-navigation, real-data, or deployment functionality. Future payment work must keep a PaymentIntent unconfirmed and incapable of success until the local `PAYMENT_COMMITTED` transaction completes.
