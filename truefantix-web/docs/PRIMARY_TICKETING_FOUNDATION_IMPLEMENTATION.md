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

### Foundation Revision 2 hardening

- Organizer submission and admin review transitions acquire a PostgreSQL row lock before reading the current state. Concurrent conflicting transitions cannot both commit or emit audit/outbox records.
- Platform `ADMIN` bypass remains available only to explicit platform review/suspension operations. Every OWNER-only invitation, membership, and event-assignment service call passes `allowPlatformAdmin: false` and requires a current active OWNER membership after the organizer lock is acquired.
- Suspension blocks invitation creation and acceptance, invitation revocation, membership role/revocation changes, and event-assignment changes. Only the defined platform review/restoration path remains available while suspended.
- Review, invitation revocation, membership change/revocation, and assignment revocation require a trimmed non-empty reason before mutation.
- The PostgreSQL suite now separately proves conflicting-transition serialization; concurrent final-owner protection; ADMIN denial across all OWNER-only mutation families; banned and stale-role denial; invitation duplicate, expiry, replay, and suspended-acceptance behavior; reason enforcement; cross-tenant denial; and complete rollback with no audit/outbox residue when protected persistence fails.
- Revision 2 verification on a newly provisioned disposable PostgreSQL 16 database: all 36 migrations applied; all 8 organizer integration tests and the complete 56-suite / 350-test run passed; TypeScript, production build, focused lint, full lint with 0 errors and 619 pre-existing warnings, and `git diff --check` passed. The database/container was removed after verification.

## Draft Event Authoring Services milestone

- `PrimaryEvent` now contains required draft identity, description/category, inline venue/address, local start/end, IANA timezone, accessibility/contact, and draft-policy fields.
- Its only states are `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, and `REJECTED`; there is no public/published state.
- An active OWNER of an approved, non-suspended organizer may create and submit drafts. Submission accepts `DRAFT` only and revalidates the complete persisted event snapshot while the organizer and event rows are locked. Active OWNERs and active assigned EVENT_MANAGERs may edit in `DRAFT` or `REJECTED`; editing a rejected draft returns it to `DRAFT` and clears the rejection reason before it may be resubmitted.
- Platform admins may review submitted events but cannot create, edit, or submit them through organizer permissions. Review transitions lock both organizer and event rows and run serializably.
- Every successful create, edit, submit, or review transition writes its redacted event audit and outbox intent in the same transaction.
- ISO local inputs intentionally contain no UTC offset. They are stored as PostgreSQL wall-clock timestamps and paired with a validated IANA timezone. Conversion to an admission/sales instant, including explicit ambiguous/nonexistent DST-time handling, is deferred and must be resolved before publication or sales is authorized.
- Migration `20260910151000_add_primary_event_authoring` backfills any synthetic shell row with inert placeholders solely so the required-column migration is deployable. Such a row cannot pass service validation or submission until edited with complete valid draft data.
- Verification on 2026-09-10 used a newly provisioned disposable PostgreSQL 16 `primary_ticketing_test` database: all 37 migrations applied and Prisma reported the schema current; all 6 event tests plus the existing 8 organizer tests passed; the complete integration-enabled run passed 57 suites / 356 tests; Prisma format/validation/generation, TypeScript, production build, focused lint, full lint with 0 errors and 619 pre-existing warnings, and diff checks passed. The disposable database/container was removed afterward.

### Event Revision 1 hardening

- Submission revalidates the locked database snapshot rather than trusting earlier create/edit validation. A PostgreSQL test proves a migrated placeholder row remains `DRAFT` and leaves no audit/outbox residue after failed submission.
- `REJECTED` events cannot be submitted directly. The lifecycle test proves rejection must be followed by a valid edit back to `DRAFT` before resubmission.
- Event-service PostgreSQL coverage separately proves unverified, banned, and stale-role actors cannot create events and leave no event, audit, or outbox writes.
- Revision 1 verification on a newly provisioned disposable PostgreSQL 16 database: all 37 migrations applied and Prisma reported the schema current; all 9 event tests plus the existing 8 organizer tests passed; the complete integration-enabled run passed 57 suites / 359 tests; Prisma format/validation/generation, TypeScript, production build, focused lint, full lint with 0 errors and 619 pre-existing warnings, and `git diff --check` passed. The disposable database/container was removed afterward.

## GA Capacity and Ticket-Type Foundation

- `PrimaryEvent.totalCapacity` is a positive integer allocation ceiling. It is mutable only while the event is in the editable draft workflow and does not represent on-sale inventory or availability.
- `PrimaryTicketType` is isolated from secondary marketplace tickets and stores only general-admission draft configuration: organizer/event tenancy, name/optional description, positive allocation, `ACTIVE | INACTIVE`, optional positive per-order limits, one recognized ISO currency, and a positive integer face-value amount in minor units.
- Capacity and ticket-type mutations run serializably and lock organizer, event, and ticket-type rows in that order. Active allocations are summed inside the transaction; inactive allocations do not consume the event ceiling. Active types for an event must share one currency.
- OWNERs and active assigned EVENT_MANAGERs may mutate these draft records for approved, non-suspended organizers. Platform-admin bypass, cross-tenant access, unassigned managers, and post-draft mutation are denied.
- Event submission now requires a valid positive capacity and at least one active, positively allocated ticket type. This is configuration readiness only and makes no public sale, reservation, or availability claim.
- `basePriceMinor` is draft face value only. It is not an all-in price and does not calculate or promise fees, tax, processor costs, organizer proceeds, settlement, or refunds.
- Migration `20260910154500_add_primary_ga_capacity_ticket_types` backfills existing synthetic events with capacity `1`, removes the default for new events, creates the isolated ticket-type table, and enforces positive integer money/allocation/order-limit and currency-shape checks at the database layer.
- Verification on 2026-09-10 used a newly provisioned disposable PostgreSQL 16 `primary_ticketing_test` database: all 38 migrations applied and Prisma reported the schema current; all 7 GA ticket-type, 9 event, and 8 organizer PostgreSQL tests passed; the complete integration-enabled run passed 58 suites / 366 tests; Prisma format/validation/generation, TypeScript, production build, focused lint, full lint with 0 errors and 619 pre-existing warnings, and `git diff --check` passed. The disposable database/container was removed afterward.

## GA Reservation Foundation

- `PrimaryInventoryReservation` is isolated from secondary tickets/orders and contains only organizer/event/ticket-type tenancy, an authenticated verified buyer reference, positive quantity, lifecycle state/timestamps, and command idempotency keys. It has no cart, order, quote, payment-provider, or credential fields.
- The only states are `HELD`, `PAYMENT_COMMITTED`, `RELEASED`, and `EXPIRED`. Create uses the injected server-owned clock and a ten-minute hold TTL. Commit records `paymentCommittedAt` and `reconciliationAfter`; no provider call exists.
- Reservable ticket-type quantity is `allocatedQuantity - sum(unexpired HELD) - sum(PAYMENT_COMMITTED)`. The same committed quantities summed across all event types may not exceed event capacity. Expired-by-clock HELD rows no longer consume capacity even before the explicit idempotent expiry transition records their terminal state.
- Every mutation runs serializably with one lock order: organizer, event, every event ticket type ordered by ID, then every event reservation ordered by ID. This serializes last-unit holds and cross-ticket-type event-capacity contention.
- Holds require a current authenticated, verified, non-banned non-admin user; an approved non-suspended organizer; an `APPROVED` event; an `ACTIVE` ticket type; a positive quantity; and the type's optional minimum/maximum order limits. Foreign tenant/type identifiers are concealed.
- Create, release, expire, and commit commands have unique idempotency keys. Exact replay returns the existing result without duplicate audit/outbox writes; changed create input with the same key is rejected.
- `PAYMENT_COMMITTED` and expiry are internal test-only operations protected by a module-private opaque capability that can be issued only when the actual process is an `isolated-test` test runtime. PAYMENT_COMMITTED rows cannot be expired automatically and continue consuming capacity beyond both hold expiry and reconciliation timing.
- Every successful lifecycle transition records a protected audit/outbox pair in the same transaction. Payloads include only organizer/event/type/reservation IDs, quantity, and state—never buyer identity, contact, price, or payment data.
- Migration `20260910160000_add_primary_ga_reservations` adds only the four-state reservation table, positive-quantity/state-metadata constraints, tenant foreign keys, lifecycle indexes, and unique command keys.
- Verification on 2026-09-10 used a newly provisioned disposable PostgreSQL 16 `primary_ticketing_test` database: all 39 migrations applied and Prisma reported the schema current; all 8 reservation, 7 GA ticket-type, 9 event, and 8 organizer PostgreSQL tests passed; the complete integration-enabled run passed 59 suites / 374 tests; Prisma format/validation/generation, TypeScript, production build, focused lint, full lint with 0 errors and 619 pre-existing warnings, and `git diff --check` passed. The disposable database/container was removed afterward.

## Primary Order and Price-Snapshot Foundation

- One provider-free `PrimaryOrder` binds one authenticated buyer and exactly one reservation. Composite foreign keys prove the order's organizer/event/buyer match that reservation, and the sole line's reservation/ticket-type pair proves it snapshots the reserved type. Direct cross-tenant, cross-event, cross-buyer, and wrong-ticket inserts fail in PostgreSQL.
- Immutable component rows snapshot an automatic `FACE_VALUE` component plus optional internally configured, explicitly coded `MANDATORY_FEE` or `TAX` test components. No permanent TrueFanTix fee or tax policy is encoded.
- All money and quantities use positive PostgreSQL `INTEGER` values, with an explicit maximum of `2,147,483,647`. The service rejects any input or derived subtotal/gross total above that bound before writing. PostgreSQL evaluates `quantity × unitFaceValueMinor` as `BIGINT` inside its check to avoid constraint-expression overflow. `faceValueSubtotalMinor = quantity × unitFaceValueMinor`; `grossTotalMinor = sum(all component amounts)`.
- Per-unit allocation is deterministic: `allocationBaseMinor = floor(componentAmount / quantity)` and the first `allocationRemainderUnits = componentAmount mod quantity` future units receive one additional minor unit. This always reconciles exactly without floating point.
- Creation requires a current verified non-admin buyer owning an unexpired `HELD` reservation in an approved/non-suspended organizer, approved event, and active recognized-currency ticket type. Exact replay is idempotent; changed bindings conflict; concurrent one-order attempts serialize.
- The only order states are `PENDING_PAYMENT` and `PAYMENT_PROCESSING`. Preparation persists the exact idempotency key and reconciliation delay; replay must match order, organizer/event scope, and delay or returns `IDEMPOTENCY_CONFLICT` without extra audit/outbox writes. The transaction commits the reservation before advancing the order. No provider-capable action exists.
- PostgreSQL triggers reject changes to order financial identity/totals and every UPDATE or DELETE of line/component evidence. Only the narrowly permitted order status, preparation metadata/timestamp, and `updatedAt` fields may transition. The eventual runtime role must also lack `TRUNCATE`; migrations and disposable-test cleanup remain owner-only operations.
- Migration `20260910162000_add_primary_order_snapshots` adds the provider-free records. Follow-up migration `20260910163500_harden_primary_order_snapshots` adds composite tenancy/type integrity, preparation-command metadata, aligned integer checks, and database immutability triggers.
- Follow-up migration `20260910164500_bind_primary_order_children` closes the child-parent boundary: `(orderId, reservationId)` on each line must match its parent order, and `(orderLineId, orderId)` on each component must match one actual line/order pair. The existing reservation/ticket-type binding remains in force.
- Order Revision 1 verification on 2026-09-10 used a newly provisioned disposable PostgreSQL 16 `primary_ticketing_test` database: all 41 migrations applied; all 11 order, 8 reservation, 7 ticket-type, 9 event, and 8 organizer PostgreSQL tests passed; the complete integration-enabled run passed 60 suites / 385 tests; Prisma format/validation/generation and migration status, TypeScript, production build, focused/full lint, and `git diff --check` passed. The disposable database/container was removed afterward.
- Order Revision 2 verification used a fresh disposable PostgreSQL 16 database: all 42 migrations applied and migration status was current; all 13 order, 8 reservation, 7 ticket-type, 9 event, and 8 organizer PostgreSQL tests passed; the complete run passed 60 suites / 387 tests. Direct SQL tests prove cross-reservation lines and cross-order components are rejected while normal service creation succeeds.

## Stripe Test-Mode Payment Attempt Foundation

- The payment boundary is isolated behind `PrimaryStripeAdapter`. Runtime configuration requires the verified primary preflight capability, an `sk_test_` secret, and a `whsec_` signing secret; live keys fail closed. Secrets, client secrets, raw webhook bodies, card data, and buyer contact data are never persisted or audited.
- The authoritative local boundary is one serializable transaction: lock scope, reject cross-order/scope attempt-key reuse, validate the still-committable reservation, move `HELD -> PAYMENT_COMMITTED` and `PENDING_PAYMENT -> PAYMENT_PROCESSING`, create the scoped attempt, and write every audit/outbox record. Any validation or persistence failure rolls back that entire unit. Only after it commits may the adapter create an unconfirmed test PaymentIntent. The service returns the persisted attempt, never a client secret, and there is no checkout/public route.
- Expected amount/currency and organizer/event/order/reservation identity come only from immutable local snapshots. Provider metadata is server-owned. One attempt per order, unique platform/provider keys, composite scope foreign keys, and provider-event IDs enforce replay safety and durable deduplication.
- Attempt states are `PENDING_PROVIDER`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, and `RECONCILIATION_REQUIRED`. Database triggers make attempt command/scope/value/provider identity immutable, permit only enumerated lifecycle transitions and one-time provider attachment, and make provider events/exceptions append-only. Signed provider events are stored only as safe identifiers/type/time plus a SHA-256 body digest. Exact repeats are no-ops; a reused provider-event ID with a different digest or material identity fails closed.
- Success requires exact provider intent, amount, currency, order, organizer, event, and reservation matching while inventory remains `PAYMENT_COMMITTED`. Any mismatch becomes an explicit `PROVIDER_MISMATCH`. Success after proven terminal release creates `LATE_SUCCESS_REFUND_REQUIRED`; it does not mark the order paid or issue admission.
- A signed failed/cancelled outcome releases committed inventory only when the adapter marks it terminal. The Stripe adapter treats cancellation—not an ordinary `payment_failed` event—as terminal proof. Release, attempt/order transition, provider-event persistence, audit, and outbox are one serializable transaction. Ambiguous provider creation or reconciliation stays capacity-safe and requires review.
- A verified webhook racing the post-provider attachment step is correlated through exact server-owned order/organizer/event/reservation metadata plus expected amount/currency. The transaction attaches the previously null provider identity once and processes the durable event; it neither drops the event nor trusts unverified client correlation.
- Verification on 2026-09-10 used a fresh disposable PostgreSQL 16 database: all 43 migrations deployed and status was current; all 7 payment, 13 order, 8 reservation, 7 ticket-type, 9 event, and 8 organizer PostgreSQL tests passed; the full integration-enabled run passed 61 suites / 394 tests.
- Migration `20260910171500_add_primary_payment_attempts` adds only scoped attempts, deduplicated provider events, exception/refund-obligation evidence, minimal paid/failed order states, composite constraints, and the reviewed order-transition trigger extension.
- Follow-up migration `20260910174000_harden_primary_payment_evidence` adds attempt evidence/transition protection and append-only provider-event/exception triggers. Payment Revision 1 expands the payment PostgreSQL suite to 11 tests covering pre-effect key conflicts, direct evidence mutation/deletion, changed-payload replay, and pre-attachment webhook recovery.
- Payment Revision 1 verification used a newly provisioned disposable PostgreSQL 16 database: all 44 migrations deployed cleanly and status was current; all 11 payment, 13 order, 8 reservation, 7 ticket-type, 9 event, and 8 organizer PostgreSQL tests passed (56/56); all 60 repository-local suites / 391 tests passed; Prisma format/validation/generation, TypeScript, production build, focused/full lint, and `git diff --check` passed. The separately deployed live-API registration probe remained externally rate-limited and is not branch evidence.
- Payment Revision 2 requires no migration: the existing order service exposes its protected preparation operation to the payment service's transaction, making attempt creation, reservation/order transitions, and audit/outbox evidence atomic. Tests prove an expired hold leaves zero new evidence and can retry after correction, while an injected preparation-outbox conflict rolls back the complete local unit before any provider call.
- Payment Revision 2 verification on the isolated PostgreSQL 16 database kept all 44 migrations current; all 13 payment tests and all 58 PostgreSQL service tests passed; the complete integration-enabled regression passed 61 suites / 400 tests. Prisma validation/migration status, TypeScript, production build, focused/full lint, and `git diff --check` passed.

## Admission Credential Foundation

- `PrimaryAdmissionTicket` is a durable entitlement created once for each immutable order-line unit. Composite foreign keys bind every row to the exact order scope and exact line/reservation/ticket-type tuple; `(orderId, unitNumber)` enforces exact cardinality under replay.
- `PrimaryAdmissionCredential` is one immutable generation in this milestone. Its ID is a cryptographically random UUID. The canonical Ed25519 payload is `{"v":1,"cid":"<credential UUID>","eventId":"<primary event ID>","iat":"<ISO-8601 UTC>","kid":"<test key ID>"}`. It contains no buyer identity, contact data, price, seat, or order data. The database stores only safe payload metadata and its SHA-256 digest—never the signature, private key, or complete bearer token. Authorized exact replay reconstructs the canonical payload and deterministically re-signs it with the protected private key.
- Signing configuration is available only after primary preflight and requires a `test_` key ID plus a matching Ed25519 PKCS#8 private key/SPKI public key pair. Missing, malformed, mismatched, non-Ed25519, or non-test configuration fails closed. Private-key custody remains environment-secret infrastructure; keys must never enter source, database, audit, or logs.
- Issuance is internal/synthetic-only and requires a strictly reconciled `PAID` order with one `SUCCEEDED` attempt and no payment exception. One serializable, retry-safe transaction locks the order, creates exactly the order-line quantity, and writes each credential plus protected audit/outbox evidence. Any failure rolls back the entire issuance.
- Internal verification requires exactly the five canonical fields with strict primitive types, a v4 UUID, and canonical ISO-8601 UTC timestamp; unknown fields are rejected. It checks the supplied signature cryptographically, then compares version, key ID, expected event, stored digest/timestamp, and current entitlement status. `VOIDED` is the only transition and can never restore usability. There is no QR rendering, public route, scanner, check-in, transfer, reissue, or refund behavior.
- Rotation in this foundation is deliberately manual and test-only: a new issuer uses a new `test_` key ID, while verification of historical credentials requires retaining its public key. A reviewed multi-key public verification keyring and custody/rotation runbook are required before any pilot; old private keys need not remain online.
- Migration `20260910181500_add_primary_admission_credentials` adds only the two admission records, composite integrity constraints, exact-unit uniqueness, checks, and database immutability/void-transition triggers.
- Follow-up migration `20260910183500_harden_primary_admission_issuance` removes stored signatures and adds a database INSERT guard. The guard locks and verifies the exact immutable line quantity, PAID parent order, SUCCEEDED scoped payment attempt, and absence of payment exceptions before any entitlement can be inserted directly or through the service.
- Verification on a newly provisioned disposable PostgreSQL 16 database: all 45 migrations deployed cleanly and status was current; all 7 admission, 13 payment, 13 order, 8 reservation, 7 ticket-type, 9 event, and 8 organizer PostgreSQL tests passed (65/65); the complete integration-enabled regression passed 62 suites / 407 tests. Prisma format/validation/generation, TypeScript, production build, focused/full lint, and `git diff --check` passed.
- Credential Revision 1 verification used a fresh disposable PostgreSQL 16 database: all 46 migrations deployed cleanly and status was current; all 8 admission tests and all 66 primary-domain PostgreSQL tests passed; the complete integration-enabled regression passed 62 suites / 408 tests. The expanded tests cover every direct database eligibility rejection, signature-free stored evidence, correctly signed schema/type/version/UUID/timestamp negatives, canonical base64url enforcement, and ordinary issuance/replay/void/rollback behavior.
- Merchant-of-record, permanent fees/taxes, refund execution, chargebacks, retries after terminal attempts, provider reconciliation operations, credentials, payout/reserve accounting, and settlement remain unresolved and excluded.

## Risks and open decisions

- The preflight depends on explicit environment configuration and database naming. Deployment configuration remains intentionally absent until an isolated preview is separately authorized.
- Event authoring remains pre-publication only. Event publication, discoverability, purchasability, DST-to-instant resolution, ticketing, and operational venue normalization remain deferred.
- Audit snapshots use a deliberately small allowlist. Each later domain must explicitly add safe fields rather than persisting arbitrary request objects.
- The outbox foundation stores delivery intent only. No dispatcher, email, webhook, or external side effect is implemented.
- CRUD endpoints remain out of scope. Invitation acceptance is service-only and enforces authenticated ownership of the normalized verified email.
- Service inputs assume the route boundary has authenticated the supplied actor identity; the service independently reloads the user to enforce current role, verified email, and ban state. No route is included in this milestone.
- Invitation delivery is intentionally absent. The raw invitation token is returned once to a future approved delivery boundary and is never persisted or audited.
- Organizer rejection reasons and operational review policy remain product/operations decisions. The service requires a reason but does not expose a workflow or send notifications.
- Event categories remain normalized free text pending an approved product taxonomy. No category drives public navigation or policy behavior.
- Venue data is a denormalized draft snapshot for this milestone and remains editable only in allowed draft states; venue deduplication and a reusable `PrimaryVenue` entity remain deferred.
- Draft policy text is not buyer-facing and has no legal effect. Legal must approve the final refund/cancellation/terms structure before publication.

### Append-only audit enforcement before real data

The current synthetic-only foundation treats `PrimaryAuditEvent` rows as append-only by service convention; Prisma's application role can still technically update or delete them. Before any real organizer or attendee data is permitted, deployment must use a dedicated PostgreSQL application role with `SELECT` and `INSERT` on `PrimaryAuditEvent`, no `UPDATE`, `DELETE`, or `TRUNCATE`, and no table-owner or bypass-RLS privileges. Migrations must run under a separate owner role. A database integration test must prove the runtime role can insert but receives a permission error for update, delete, and truncate. The same test and grants must be release-gate evidence; synthetic development may continue until then.

## Explicit exclusions

This implementation contains no organizer/event UI or route, external email delivery, event publication/discovery, ticket types, sellable capacity, holds/comps, inventory, reservation, checkout, Stripe/banking, fee/tax calculation, credential, QR, transfer, scan, refund, ledger, settlement, report, public-navigation, real-data, or deployment functionality. Future payment work must keep a PaymentIntent unconfirmed and incapable of success until the local `PAYMENT_COMMITTED` transaction completes.
