# Primary Ticketing Foundation Implementation

**Branch:** `feat/primary-ticketing-foundation`

**Scope:** Section 13 narrow foundation only

**Status:** Ready for implementation review; disabled by default

## Implemented

- A server-only feature preflight that fails closed unless all of the following are true:
  - `PRIMARY_TICKETING_ENABLED=true`;
  - `PRIMARY_TICKETING_ENVIRONMENT_ID` is `isolated-test` or `isolated-preview`;
  - `PRIMARY_TICKETING_DEPLOYMENT_ID` exactly matches that isolated identity;
  - live production deployment identity (`VERCEL_ENV=production` or `PRIMARY_TICKETING_DEPLOYMENT_ID=live-production`) is forbidden;
  - an isolated preview requires `VERCEL_ENV=preview` (and may use the platform-standard `NODE_ENV=production`);
  - `PRIMARY_TICKETING_DATABASE_URL` exactly matches the process `DATABASE_URL`; and
  - the PostgreSQL database name explicitly identifies a primary-ticketing test or preview database.
- An unavailable-by-default `/api/primary/health` route. Disabled or unsafe configurations return the same `404 NOT_FOUND` response.
- Dedicated organizer, membership, invitation, minimal event identity, event-staff assignment, audit, and outbox models. They have no relation to secondary `Ticket`, `Order`, `Payment`, `Payout`, or `Seller` records.
- Composite tenant foreign keys prevent an event assignment or event audit record from crossing organizer boundaries.
- Deny-by-default organizer and event authorization services. Every tenant query includes `organizerId`; non-owner event access also requires an active assignment belonging to the same organizer.
- A transactional helper that writes a redacted audit record and idempotent outbox message through the caller's existing database transaction. It requires an opaque capability issued only by successful primary preflight, so a caller cannot omit the gate and still write.

## Isolated environment contract

These variables are examples only; no credential or environment file is committed:

```dotenv
NODE_ENV=test
PRIMARY_TICKETING_ENABLED=true
PRIMARY_TICKETING_ENVIRONMENT_ID=isolated-test
PRIMARY_TICKETING_DEPLOYMENT_ID=isolated-test
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

### Foundation Revision 1

- Focused preflight, write-boundary, authorization, and health tests: 4 suites / 19 tests passed.
- Full regression tests: 55 suites / 342 tests passed.
- TypeScript and focused lint: passed with no errors.
- Explicit deployment-identity coverage proves an isolated Vercel preview is accepted with `NODE_ENV=production`, while `VERCEL_ENV=production`, a live-production identity, mismatched identities, and an unverified preview are rejected.
- Write-boundary coverage proves audit/outbox persistence is rejected before either database create call unless the helper receives a capability issued by successful preflight.

## Organizer Domain Services milestone

The service-only `PrimaryOrganizerService` implements the authorized organizer administration boundary with no routes or UI:

- verified-user organizer draft creation and the first active `OWNER` membership in one serializable transaction;
- owner submission and platform-admin review, approval, rejection, suspension, reopening, and restoration using explicit state transitions;
- normalized-email invitations with cryptographically random bearer tokens, peppered SHA-256 database hashes, expiry, single-active-invitation checks, matching verified-account acceptance, and revocation;
- owner-controlled membership role changes and revocation, with organizer-row locking and a final-active-owner invariant;
- owner-controlled event assignment and revocation against the existing tenancy-only event shell;
- tenant-scoped lookups that conceal foreign identifiers; and
- a protected audit and idempotent outbox record in the same transaction as every successful sensitive mutation.

The PostgreSQL integration suite uses only synthetic users on a disposable isolated database. It covers the organizer lifecycle, suspension behavior, invitation matching/revocation, role changes, membership revocation, event assignment/revocation, final-owner protection, unverified-user rejection, cross-tenant rejection, and matching audit/outbox counts. It is opt-in through `PRIMARY_INTEGRATION_DATABASE_URL`; ordinary test runs skip it rather than connecting to an unapproved database.

Verification on 2026-09-10 used a newly provisioned disposable PostgreSQL 16 database named `primary_ticketing_test`: all 36 migrations deployed cleanly; the 2 database-backed organizer integration tests passed; all 56 suites / 344 tests passed with integration enabled; TypeScript and the production build passed; focused lint passed; full lint completed with 0 errors and 619 pre-existing warnings; and `git diff --check` passed. The disposable database was destroyed after verification.

## Risks and open decisions

- The preflight depends on explicit environment configuration and database naming. Deployment configuration remains intentionally absent until an isolated preview is separately authorized.
- The event model is only an identity/tenancy shell required for staff assignments; event authoring and lifecycle fields are not included.
- Audit snapshots use a deliberately small allowlist. Each later domain must explicitly add safe fields rather than persisting arbitrary request objects.
- The outbox foundation stores delivery intent only. No dispatcher, email, webhook, or external side effect is implemented.
- CRUD endpoints remain out of scope. Invitation acceptance is service-only and enforces authenticated ownership of the normalized verified email.
- Service inputs assume the route boundary has authenticated the supplied actor identity; the service independently reloads the user to enforce current role, verified email, and ban state. No route is included in this milestone.
- Invitation delivery is intentionally absent. The raw invitation token is returned once to a future approved delivery boundary and is never persisted or audited.
- Organizer rejection reasons and operational review policy remain product/operations decisions. The service requires a reason but does not expose a workflow or send notifications.

### Append-only audit enforcement before real data

The current synthetic-only foundation treats `PrimaryAuditEvent` rows as append-only by service convention; Prisma's application role can still technically update or delete them. Before any real organizer or attendee data is permitted, deployment must use a dedicated PostgreSQL application role with `SELECT` and `INSERT` on `PrimaryAuditEvent`, no `UPDATE`, `DELETE`, or `TRUNCATE`, and no table-owner or bypass-RLS privileges. Migrations must run under a separate owner role. A database integration test must prove the runtime role can insert but receives a permission error for update, delete, and truncate. The same test and grants must be release-gate evidence; synthetic development may continue until then.

## Explicit exclusions

This implementation contains no organizer UI/route, external email delivery, full event authoring, inventory, reservation, checkout, Stripe/banking, credential, QR, transfer, scan, refund, ledger, settlement, report, public-navigation, real-data, or deployment functionality. Future payment work must keep a PaymentIntent unconfirmed and incapable of success until the local `PAYMENT_COMMITTED` transaction completes.
