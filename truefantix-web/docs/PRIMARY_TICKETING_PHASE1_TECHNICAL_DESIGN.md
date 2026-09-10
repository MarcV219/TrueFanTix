# Primary Ticketing Phase 1 — Technical Design

**Status:** Proposed for review; no migrations or implementation authorized

**Branch:** `feat/primary-ticketing-foundation`

**Baseline:** `origin/dev` at `dbe4306`

**Scope:** Small Canadian independent, general-admission events in an isolated test environment

## 1. Purpose and non-negotiable boundaries

This design adds a modular primary-ticketing system without changing the meaning of TrueFanTix's existing secondary-marketplace `Ticket`, `Order`, `OrderItem`, `Payment`, `Payout`, or `Seller` records.

Phase 1 permits approved organizers to create general-admission events, sell first-party inventory through Stripe test mode, issue signed admission credentials, scan them online, invalidate them after transfer/refund/void, and preview settlement reporting through an append-only test ledger.

The following boundaries are mandatory:

- `PRIMARY_TICKETING_ENABLED` defaults to disabled. Every primary page, API, webhook handler, background job, and service entry point fails closed on the server when disabled.
- Development uses a separate preview deployment, separate non-production PostgreSQL database, Stripe test-mode keys and objects, separate signing/encryption secrets, and test-only email configuration.
- The preview UI displays a persistent `PRIMARY TICKETING TEST — NO REAL SALES` banner.
- Only synthetic organizers, events, buyers, orders, credentials, scans, and ledger entries are permitted.
- No live organizer payouts are implemented. Settlement is a test ledger and statement preview only.
- Only `AdmissionCredential` records issued for an approved primary event can produce TrueFanTix admission QR codes.
- Existing secondary tickets retain the venue-issued ticket and transfer workflow. Secondary `Ticket` or `Order` identifiers are rejected by the credential issuer.
- Reserved seating, offline scanning, wallets, dynamic pricing, high-demand queues, and production launch are out of scope.

## 2. Recommended module boundary

Place primary code under explicit namespaces rather than adding primary behavior to existing marketplace services:

```text
src/app/primary/                         primary pages
src/app/api/primary/                     authenticated primary APIs
src/app/api/webhooks/stripe-primary/     isolated Stripe test webhook
src/lib/primary/                         domain/application services
  organizer/
  events/
  inventory/
  orders/
  admission/
  settlement/
  reporting/
  integrations/
```

Dependencies point inward: route handlers call application services; services use domain rules and provider interfaces; provider adapters call Prisma, Stripe, email, QR rendering, and cryptography. Primary services must not import secondary checkout, transfer, payout, or QR behavior.

Provider interfaces:

```ts
interface PrimaryPaymentProvider { createIntent(...): Promise<...>; refund(...): Promise<...> }
interface PrimaryEmailProvider { sendOrderReceipt(...): Promise<...>; sendCredential(...): Promise<...> }
interface CredentialSigner { sign(claims: CredentialClaims): Promise<string>; verify(token: string): Promise<VerifiedClaims> }
interface PrimaryTaxProvider { quote(input: TaxQuoteInput): Promise<TaxQuote> }
interface PrimaryAssetStore { put(...): Promise<StoredAsset> }
interface PrimaryResaleBridge { createEligibility(...): Promise<...>; invalidateEligibility(...): Promise<...> }
```

The tax adapter initially returns a configured/test quote but stores the complete quote snapshot. It must not imply that TrueFanTix has decided tax collection or remittance responsibility.

## 3. Proposed data model

All monetary values are integer minor units with an ISO currency code. All mutable records include `createdAt` and `updatedAt`. Sensitive domain changes also create immutable `PrimaryAuditEvent` rows in the same database transaction.

### 3.1 Organizer domain

**PrimaryOrganizer**

- `id`, `legalName`, `displayName`, `businessNumberEncrypted?`
- `addressLine1`, `addressLine2?`, `city`, `region`, `postalCode`, `country`
- `supportEmail`, `supportPhone?`, `website?`
- `status: DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED | SUSPENDED`
- `statusReason?`, `submittedAt?`, `approvedAt?`, `approvedByUserId?`
- test-only payment status fields: `paymentProvider`, `paymentAccountRefEncrypted?`, `paymentStatus`

**PrimaryOrganizerMembership**

- `id`, `organizerId`, `userId`, `role`, `status`, `invitedByUserId`, `invitedAt`, `acceptedAt?`, `revokedAt?`
- roles: `OWNER | FINANCE | EVENT_MANAGER | BOX_OFFICE | SCANNER | READ_ONLY`
- unique `(organizerId, userId)`

**PrimaryOrganizerInvitation**

- `id`, `organizerId`, `emailNormalized`, `role`, `tokenHash`, `expiresAt`, `acceptedAt?`, `revokedAt?`
- unique active invitation enforced transactionally

### 3.2 Event and inventory domains

**PrimaryVenue**

- `id`, `organizerId`, `name`, address fields, `timezone`, `accessibilityNotes?`
- venue data is organizer-scoped in Phase 1; no seat maps

**PrimaryEvent**

- `id`, `organizerId`, `venueId`, `title`, `description`, `timezone`
- `doorsAt?`, `startsAt`, `endsAt?`
- `capacity`, `status: DRAFT | IN_REVIEW | APPROVED | PUBLISHED | SALES_CLOSED | CANCELLED | COMPLETED`
- `refundPolicy`, `cancellationPolicy`, `termsVersion`
- `submittedAt?`, `approvedAt?`, `approvedByUserId?`, `publishedAt?`, `cancelledAt?`, `completedAt?`
- Phase 1 treats one event as one admission performance; a later `PrimaryPerformance` extraction is possible without changing credential claims

**PrimaryTicketType**

- `id`, `eventId`, `name`, `description?`, `inventoryLimit`, `perOrderLimit`, `perBuyerLimit?`
- `salesStartAt`, `salesEndAt`, `status: DRAFT | ACTIVE | PAUSED | SALES_CLOSED`
- price snapshot inputs: `basePriceCents`, `mandatoryFeeCents`, `currency`, `taxPolicyRef?`
- invariant: sum of ticket-type inventory limits cannot exceed event capacity

**PrimaryInventoryReservation**

- `id`, `eventId`, `ticketTypeId`, `buyerUserId`, `quantity`, `status: ACTIVE | CONSUMED | EXPIRED | RELEASED`
- `expiresAt`, `consumedAt?`, `releasedAt?`, `checkoutKey`
- unique `checkoutKey`; index `(ticketTypeId, status, expiresAt)`

Capacity is not represented by one mutable counter alone. Availability is calculated/locked transactionally from sold quantity plus active, unexpired reservations. PostgreSQL row locking or a serializable transaction locks the `PrimaryTicketType` and `PrimaryEvent` capacity rows before creating a reservation. The transaction rejects any result exceeding either ticket-type inventory or total event capacity.

### 3.3 Order domain

**PrimaryOrder**

- `id`, `organizerId`, `eventId`, `buyerUserId`, `reservationId`
- `status: PENDING_PAYMENT | PAYMENT_PROCESSING | PAID | FULFILLED | CANCELLATION_PENDING | CANCELLED | PARTIALLY_REFUNDED | REFUNDED | PAYMENT_FAILED`
- `idempotencyKey`, `currency`
- immutable amount snapshots: `ticketSubtotalCents`, `mandatoryFeeCents`, `taxCents`, `totalCents`, `organizerProceedsCents`, `platformRevenueCents`, `processorFeeEstimateCents?`
- `taxJurisdiction?`, `taxCalculationRef?`, `paidAt?`, `fulfilledAt?`, `cancelledAt?`
- unique `idempotencyKey`, unique `reservationId`

**PrimaryOrderLine**

- `id`, `orderId`, `ticketTypeId`, `description`, `quantity`
- per-unit and line snapshots for base price, mandatory fee, tax, total, organizer proceeds, and platform revenue

**PrimaryPayment**

- `id`, `orderId`, `provider`, `providerIntentId`, `status`, amount/currency, `lastProviderEventAt?`
- unique `orderId`, unique `(provider, providerIntentId)`

**PrimaryRefund**

- `id`, `orderId`, `status: REQUESTED | PROCESSING | SUCCEEDED | FAILED | CANCELLED`
- `reason`, `requestedByUserId`, amount component snapshots, `providerRefundId?`, timestamps
- unique `(providerRefundId)` when present; client idempotency key required

**PrimaryWebhookDelivery**

- `id`, `provider`, `providerEventId`, `eventType`, `payloadHash`, `receivedAt`, `processedAt?`, `status`, `error?`
- unique `(provider, providerEventId)` prevents replay

### 3.4 Admission domain

**PrimaryAdmissionTicket**

- `id`, `orderLineId`, `eventId`, `ticketTypeId`, `ownerUserId`, `sequenceWithinLine`
- `status: ISSUED | TRANSFER_PENDING | TRANSFERRED | VOIDED | REFUNDED | CHECKED_IN`
- `issuedAt`, `transferredAt?`, `voidedAt?`, `refundedAt?`, `checkedInAt?`
- unique `(orderLineId, sequenceWithinLine)`

This is the durable entitlement. It is deliberately not the existing secondary `Ticket` model.

**AdmissionCredential**

- `id` generated from cryptographically secure random bytes, not a sequential identifier
- `admissionTicketId`, `eventId`, `generation`, `tokenHash`, `keyId`
- `status: ACTIVE | SUPERSEDED | VOIDED | REFUNDED | CHECKED_IN`
- `issuedAt`, `expiresAt?`, `invalidatedAt?`, `invalidationReason?`
- unique `(admissionTicketId, generation)`, unique `tokenHash`
- only one active generation per ticket, enforced in the credential-rotation transaction

**AdmissionTransfer**

- `id`, `admissionTicketId`, `fromUserId`, `recipientEmailNormalized`, `toUserId?`
- `status: PENDING | ACCEPTED | EXPIRED | CANCELLED`, `tokenHash`, timestamps

**AdmissionScan**

- `id`, `eventId`, `admissionTicketId?`, `credentialId?`, `operatorUserId`, `scannerDeviceId?`
- `result: ACCEPTED | DUPLICATE | VOIDED | REFUNDED | WRONG_EVENT | UNKNOWN | INVALID_SIGNATURE | EXPIRED | UNAUTHORIZED | OVERRIDE_ACCEPTED | OVERRIDE_REJECTED`
- `scannedAt`, `tokenFingerprint`, `reason?`, `overrideOfScanId?`, `overrideReason?`, `supervisorUserId?`
- every attempt is retained; `tokenFingerprint` is non-reversible and supports investigation without storing raw QR tokens

**PrimaryScannerDevice**

- `id`, `organizerId`, `label`, `publicDeviceId`, `status`, `lastSeenAt?`
- device metadata only; no claim of offline trust

### 3.5 Settlement, reporting, and audit domains

**OrganizerLedgerEntry**

- `id`, `organizerId`, `eventId?`, `orderId?`, `refundId?`
- `entryType: TICKET_REVENUE | PLATFORM_FEE | TAX_LIABILITY | PROCESSOR_FEE | REFUND | CHARGEBACK | RESERVE_HOLD | RESERVE_RELEASE | SETTLEMENT_PREVIEW | ADJUSTMENT`
- `direction: DEBIT | CREDIT`, `amountCents`, `currency`, `effectiveAt`
- `idempotencyKey`, `reversesEntryId?`, `description`, `metadataJson?`
- unique `idempotencyKey`; rows are append-only and corrections use reversing entries

**PrimarySettlementStatement**

- `id`, `organizerId`, `eventId`, period, status `DRAFT | FINALIZED | VOIDED`
- opening, sales, fees, taxes, refunds, reserves, and closing balance snapshots
- statement generation reads the ledger; it never mutates ledger balances

**PrimaryAuditEvent**

- `id`, `organizerId?`, `eventId?`, `actorUserId?`, `actorType`, `action`
- `targetType`, `targetId`, `beforeJson?`, `afterJson?`, `reason?`, `requestId?`, `ipHash?`, `createdAt`
- append-only; sensitive values and raw credentials are excluded

### 3.6 Relationship summary

```text
User ──< OrganizerMembership >── PrimaryOrganizer ──< PrimaryEvent ──< PrimaryTicketType
                                      │                  │                    │
                                      └──< PrimaryVenue  └──< Reservation >──┘
                                                            │
User (buyer) ──< PrimaryOrder ──< PrimaryOrderLine ──< PrimaryAdmissionTicket
                       │                                      │
                       ├── PrimaryPayment                     ├──< AdmissionCredential
                       ├──< PrimaryRefund                     ├──< AdmissionTransfer
                       └──< OrganizerLedgerEntry              └──< AdmissionScan
```

## 4. State machines and invariants

Invalid transitions return `409 INVALID_STATE`; all accepted transitions are audited.

### Organizer

`DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED`

- Admin may send `UNDER_REVIEW -> REJECTED` or `APPROVED -> SUSPENDED`.
- Applicant may revise `REJECTED -> DRAFT`.
- Only approved organizers may submit events, and suspension blocks new sales and sensitive organizer operations.

### Event

`DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> SALES_CLOSED -> COMPLETED`

- Admin may return `IN_REVIEW -> DRAFT` with reasons.
- `CANCELLED` is reachable from `APPROVED`, `PUBLISHED`, or `SALES_CLOSED` and triggers inventory closure, admission invalidation, refund workflow creation, and reversing ledger entries.
- Publication requires organizer approval, event approval, at least one valid ticket type, coherent sale dates, and inventory not exceeding capacity.

### Order and reservation

`ACTIVE reservation -> CONSUMED` only when its order reaches `PAID`; otherwise it becomes `EXPIRED` or `RELEASED`.

`PENDING_PAYMENT -> PAYMENT_PROCESSING -> PAID -> FULFILLED`

- Payment failure returns to `PENDING_PAYMENT` while the reservation is valid, otherwise `PAYMENT_FAILED`.
- `PAID/FULFILLED -> CANCELLATION_PENDING -> REFUNDED` for a complete refund.
- Partial ticket refunds produce `PARTIALLY_REFUNDED`; retained tickets and all component totals must reconcile.
- Credentials are issued only after a verified, idempotently processed `payment_intent.succeeded` event.

### Credential and transfer

- Issuance creates ticket `ISSUED` plus generation 1 credential `ACTIVE` atomically.
- Starting transfer changes ticket to `TRANSFER_PENDING`; current credential remains usable until acceptance unless product/legal review chooses immediate suspension.
- Accepting transfer atomically marks the old credential `SUPERSEDED`, changes ownership, creates the next credential generation, and sets the ticket `TRANSFERRED`.
- Void/refund atomically invalidates the active credential and marks the entitlement accordingly.
- No transition restores an invalidated credential. Reissue always creates a new generation.

### Scan

- Scan service authenticates staff, verifies event assignment and role, verifies signature/key, loads the credential by hash, and checks event/status.
- First acceptance uses one database transaction with a conditional update such as `status = ACTIVE`. Exactly one concurrent scan can change it to `CHECKED_IN`; later attempts are `DUPLICATE`.
- Each attempt creates an `AdmissionScan`, including rejects. Override requires `BOX_OFFICE` or `OWNER`, a non-empty reason, and a linked audit event.

### Refund

`REQUESTED -> PROCESSING -> SUCCEEDED` or `FAILED`; failed requests can be retried through a new provider attempt while preserving the original record/history.

- Success is driven by a signed Stripe webhook, not the browser response.
- A successful full refund invalidates all order credentials and creates exact reversing ledger entries in one idempotent transaction.

### Settlement

Ledger entries are immutable. A draft statement can be regenerated; `DRAFT -> FINALIZED -> VOIDED` is administrative reporting state only. Phase 1 never sends money to an organizer.

## 5. API and page map

All paths below are unavailable (`404 PRIMARY_TICKETING_DISABLED`) when the feature flag is off. Mutations also enforce existing CSRF/origin checks and route-specific rate limits.

### Pages

- `/primary/test-notice` — environment warning and tester entry
- `/primary/apply` — organizer application
- `/primary/organizers/[organizerId]` — organizer dashboard
- `/primary/organizers/[organizerId]/settings` — profile, staff, payment placeholder
- `/primary/organizers/[organizerId]/events/new`
- `/primary/organizers/[organizerId]/events/[eventId]` — event setup, inventory, policies
- `/primary/organizers/[organizerId]/events/[eventId]/reports`
- `/primary/checkout/[eventId]`
- `/primary/orders/[orderId]`
- `/primary/tickets` and `/primary/tickets/[ticketId]`
- `/primary/scan/[eventId]` — mobile scanner
- `/admin/primary/organizers` and `/admin/primary/events` — approval queues

### APIs

- `POST /api/primary/organizers`; `GET/PATCH /api/primary/organizers/:id`
- `POST /api/primary/organizers/:id/submit`; `POST /api/primary/admin/organizers/:id/decision`
- membership invitation/list/update/revoke under `/api/primary/organizers/:id/staff`
- event CRUD and submission/decision/publish/cancel under `/api/primary/organizers/:id/events`
- ticket-type CRUD under `/api/primary/events/:eventId/ticket-types`
- `POST /api/primary/events/:eventId/reservations`
- `POST /api/primary/orders`; `GET /api/primary/orders/:id`
- `POST /api/primary/orders/:id/payment-intent`; `POST /api/primary/orders/:id/refunds`
- `POST /api/webhooks/stripe-primary` with a dedicated test signing secret
- attendee ticket list/detail, transfer start/accept/cancel, and credential rendering under `/api/primary/tickets`
- `POST /api/primary/events/:eventId/scans`; `POST /api/primary/scans/:scanId/override`
- sales, attendance, reconciliation, and statement preview under `/api/primary/organizers/:id/reports`
- expired-reservation worker under `/api/primary/internal/reservations/expire`, protected by a primary-specific internal secret

## 6. Security and permission model

Authorization uses deny-by-default service guards and scopes every query by organizer and event. Knowing an ID never grants access.

- Platform `ADMIN`: organizer/event decisions, suspensions, audited support actions; no automatic organizer membership.
- `OWNER`: all organizer actions except platform approval; manages staff.
- `FINANCE`: orders, refunds within approved policy, ledger, statement preview, payment-status placeholder.
- `EVENT_MANAGER`: event/ticket-type management and reports; cannot manage finance or organizer ownership.
- `BOX_OFFICE`: assigned-event attendee lookup, scans, reissue/void and supervised override with reason.
- `SCANNER`: scan only for explicitly assigned events; no attendee export or financial data.
- `READ_ONLY`: non-sensitive dashboard/reports only.

`PrimaryEventStaffAssignment` should map membership to specific events for scanner/box-office access. Owner access may span the organizer; all other operational roles should be explicitly constrained.

Security controls:

- Store invitation/transfer tokens and QR tokens only as hashes; encrypt provider account references and sensitive organizer identifiers.
- QR payload contains no name, email, price, or personal data.
- Rate-limit application, reservation, payment, transfer, credential render, scan, override, and refund endpoints independently.
- Separate signing keys from session, Stripe, email, and encryption secrets. Include a `kid` for rotation.
- Do not log raw QR tokens, Stripe secrets, invitation tokens, personal data, or complete webhook payloads.
- Validate all inputs and normalize email, currency, country, region, and timezone fields.
- Require step-up authentication before owner/finance changes and supervisor overrides before pilot readiness.
- Audit organizer decisions, permissions, event publication/cancellation, price/inventory changes, refunds, credential lifecycle, scans/overrides, and statement finalization.
- Add explicit tenant-isolation tests for every organizer-scoped service and route.

## 7. Payment and financial flow proposal

Phase 1 uses Stripe test mode and separate `PRIMARY_STRIPE_*` environment variables. It must not reuse production Stripe objects or silently fall back to existing `STRIPE_*` keys.

1. The server quotes an all-in price. The first meaningful displayed price includes base price plus every mandatory non-government fee; taxes are clearly identified separately where permitted/required.
2. A serializable database transaction creates an expiring reservation and immutable order/line amount snapshots.
3. The payment adapter creates/reuses one test PaymentIntent using the primary order id and idempotency key.
4. The dedicated primary webhook verifies its dedicated signature, claims `PrimaryWebhookDelivery`, and processes each provider event once.
5. `payment_intent.succeeded` validates order, currency, and total, consumes inventory, writes ledger entries, and issues credentials atomically. External email occurs through an idempotent outbox after commit.
6. Refund requests create local intent first; Stripe test refund success creates reversing ledger entries and invalidates affected credentials idempotently.
7. Statement preview derives only from ledger entries. No Stripe Transfer or Payout is created.

Required invariant per order/refund:

```text
buyer total = ticket subtotal + mandatory fees + government taxes
organizer proceeds + platform revenue + tax liability = captured total
net ledger balance = captures - successful refunds - chargebacks +/- explicit adjustments
```

The precise allocation of processor fees, reserves, tax, platform fees, and chargebacks remains configurable and blocked on business/legal decisions.

## 8. Credential signing and verification

Recommended Phase 1 token format: compact JWS using Ed25519 (`EdDSA`) with a versioned issuer and key id. Asymmetric signing lets scanner services verify without possessing the private signing key.

Minimal claims:

```json
{
  "iss": "truefantix-primary-test",
  "aud": "truefantix-admission",
  "jti": "<128+ bit random credential id>",
  "evt": "<primary event id>",
  "gen": 2,
  "iat": 1789052400,
  "exp": 1789138800
}
```

- No buyer identity, email, ticket price, seat, or order details appear in the token.
- Private keys remain only in the secret manager; preview and any future production environment use distinct keys.
- Public verification keys are addressed by `kid`; old public keys remain available while any credential they signed can be valid.
- Database state is authoritative. A valid signature alone never grants admission: the scanner must also confirm active generation, event match, current status, authorization, and atomic first use.
- Token hash/fingerprint uses a keyed hash so leaked database values cannot be used as bearer credentials.
- QR rendering is possible only through `PrimaryCredentialIssuer`, whose input type requires a `PrimaryAdmissionTicket`. No overload accepts a secondary `Ticket`.

Online scanning is the only Phase 1 claim. Offline verification is explicitly unsafe for duplicate prevention until sync/conflict rules are designed.

## 9. Feature flag and environment isolation

Server helper `requirePrimaryTicketingEnabled()` reads `PRIMARY_TICKETING_ENABLED === "true"`; absent, malformed, or false means disabled. Route middleware/UI hiding is defense in depth only.

The helper also asserts an environment identity such as `PRIMARY_ENVIRONMENT_ID=preview-primary` and validates required primary-specific keys. In production public domains, the feature remains unavailable unless an explicit future launch control is separately approved.

Required preview configuration (names illustrative):

- `PRIMARY_TICKETING_ENABLED=true`
- `PRIMARY_ENVIRONMENT_ID=preview-primary`
- isolated `DATABASE_URL`
- `PRIMARY_STRIPE_SECRET_KEY` beginning with Stripe's test prefix
- `PRIMARY_STRIPE_WEBHOOK_SECRET`
- `PRIMARY_CREDENTIAL_SIGNING_PRIVATE_KEY`, `PRIMARY_CREDENTIAL_SIGNING_KEY_ID`
- `PRIMARY_DATA_ENCRYPTION_KEY`
- `PRIMARY_EMAIL_API_KEY`, `PRIMARY_EMAIL_FROM`
- `PRIMARY_INTERNAL_CRON_SECRET`

Startup/preflight must reject live Stripe keys, public-domain origins, missing banner configuration, or non-isolated secrets. The preview database must be newly provisioned rather than copied from production.

## 10. Integration boundary with fair resale

There is no direct primary-to-secondary model reuse in Phase 1. A future `PrimaryResaleBridge` receives an explicit `PrimaryAdmissionTicket` and creates a typed eligibility/link record such as `PrimaryResaleListingLink`.

The bridge will eventually:

- prove that TrueFanTix issued the original entitlement;
- supply original all-in price and organizer-approved resale rules;
- atomically invalidate the seller's current credential when resale completes;
- rotate ownership and issue a new credential to the buyer;
- prevent receipt upload for TrueFanTix-issued inventory;
- preserve the existing third-party transfer workflow for all secondary tickets.

The bridge must never allow a secondary listing to call credential issuance. Integration implementation waits for a separate reviewed design and tests.

## 11. Concurrency, idempotency, and reconciliation strategy

- Inventory reservation: serializable transaction or explicit `FOR UPDATE` lock on event/ticket type; retry serialization failures with a bounded policy.
- Reservation expiry: compare database time, conditionally move only `ACTIVE` rows, and make capacity immediately reusable.
- Payment/refund webhooks: unique provider event claim plus idempotent domain-operation keys.
- Credential issuance/rotation: unique ticket-generation keys and conditional invalidation inside one transaction.
- Scan: conditional `ACTIVE -> CHECKED_IN` update and attempt record in one transaction.
- Ledger: unique business-event idempotency keys; no updates/deletes.
- Reporting: reconcile order snapshots, Stripe test balance events, credential counts, inventory, refunds, and ledger sums. Any mismatch is visible and blocks statement finalization.

## 12. Test and verification plan

Before pilot review, automated tests must prove:

- concurrent reservations/checkouts cannot exceed ticket-type or event capacity;
- expired reservations return inventory;
- Stripe webhook replay changes state and ledger exactly once;
- first scan succeeds and concurrent/subsequent scans are duplicates;
- transfer acceptance supersedes the old credential;
- refunded/voided/cancelled credentials fail admission;
- wrong-event and invalid-signature tokens fail;
- scanner and box-office staff cannot access unassigned events;
- Organizer A cannot access Organizer B data through direct IDs or list filters;
- all mandatory non-government fees are present from the first price display;
- order, refund, ledger, and statement components reconcile exactly;
- feature-off primary pages/APIs/webhooks/jobs are unavailable;
- no primary path accepts secondary `Ticket`/`Order` records;
- no production credential names, keys, hosts, Stripe objects, emails, or data appear in fixtures/configuration;
- the complete existing secondary-marketplace suite remains green.

Add service-level integration tests against PostgreSQL for locking/constraints; mocked unit tests alone are insufficient for inventory and scan atomicity. Add a Stripe CLI test-mode replay drill and a manual online scanner drill using two devices.

## 13. Delivery sequence after design approval

1. Foundation: feature gate, environment preflight, primary module skeleton, primary audit/outbox conventions.
2. Organizer administration and tenant-scoped RBAC.
3. General-admission event/ticket-type management and approval.
4. Transactional reservations, checkout, test Stripe payments, and ledger writes.
5. Credential issuance, transfer, invalidation, and QR presentation.
6. Online scanner, atomic duplicate prevention, and supervised override.
7. Refund/cancellation workflows, reconciliation, reports, and statement preview.

Each milestone requires code, isolated migration, automated tests, update document, preview evidence, risks, open decisions, and exact verification results. No migration should be finalized until this design and the unresolved decisions below are reviewed.

## 14. Decisions required from Marc, legal, accounting, and operations

Engineering cannot decide these safely:

1. **Merchant of record:** TrueFanTix, organizer, or another structure; associated refund, fraud, dispute, chargeback, and negative-balance responsibility.
2. **Primary commercial model:** buyer/organizer fees, processor-fee allocation, tax treatment, and whether mandatory fees are refundable.
3. **Funds and reserves:** hold periods, reserve percentages, cancellation exposure, insurance, indemnities, and future payout timing.
4. **Tax:** registration obligations, calculation/remittance party, invoice requirements, and jurisdictional scope for the Canadian pilot.
5. **Organizer due diligence:** legal identity, beneficial ownership, sanctions/KYC, banking verification, risk tiers, required documents, and retention.
6. **Contracts:** inventory rights, exclusivity, service levels, event-day responsibilities, customer data ownership/use, resale rules, termination, and transition.
7. **Consumer policy:** refund/cancellation/postponement rules, transfer cutoffs, lost-device/reissue rules, age restrictions, and required disclosures.
8. **Privacy/marketing:** attendee exports, organizer access, consent language, retention/deletion, audit/IP data, and incident notification.
9. **Accessibility:** buyer and scanner UX requirements plus accessible admission/event operations.
10. **Event operations:** supported devices/browsers, connectivity standard, staffing, escalation, outage fallback, gate reconciliation, and override authority.
11. **Credential transfer semantics:** whether the old credential stays valid until recipient acceptance or is suspended immediately.
12. **Capacity semantics:** whether staff/comps/holds count inside sellable capacity in Phase 1 (recommended: yes, with a later explicit allocation model).
13. **Pilot boundaries:** province(s), event-size ceiling, organizer count, ticket-value ceiling, refund exposure, supported currency, and event categories.
14. **Fair-resale rules:** organizer controls, price ceiling basis, fees, transfer eligibility/cutoffs, Access Token behavior, and attendee-data effects.

## 15. Review gate and recommendation

Approve, revise, or reject this design before any schema migration, Stripe architecture, QR issuer, or preview deployment is finalized. The next engineering milestone should remain organizer administration only after reviewers agree on:

- separation from the secondary marketplace;
- tenant and role model;
- inventory locking strategy;
- order/refund/ledger amount boundaries;
- signing and scan-verification design;
- feature/environment isolation; and
- the named legal, finance, privacy, and event-operations owners for unresolved decisions.
