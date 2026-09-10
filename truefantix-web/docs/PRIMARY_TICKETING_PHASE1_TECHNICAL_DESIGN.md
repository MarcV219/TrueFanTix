# Primary Ticketing Phase 1 — Technical Design

**Status:** Proposed for review; no migrations or implementation authorized

**Branch:** `feat/primary-ticketing-foundation`

**Baseline:** `origin/dev` at `dbe4306`

**Scope:** Small Canadian independent, general-admission events in an isolated test environment

**Revision:** 2 — incorporates review findings 1–12; approved for the narrow Section 13 foundation milestone

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
- acceptance requires an authenticated user whose verified normalized email equals `emailNormalized`; possessing or forwarding the token alone never grants membership

**PrimaryEventStaffAssignment**

- `id`, `eventId`, `membershipId`, `status: ACTIVE | REVOKED`, `assignedByUserId`, `assignedAt`, `revokedByUserId?`, `revokedAt?`, `revocationReason?`
- unique `(eventId, membershipId)`; an assignment must reference a membership belonging to the event's organizer
- `OWNER` memberships and platform `ADMIN` users bypass event assignment checks but remain audited; every other operational role requires an active assignment for event-scoped access
- only `OWNER` may assign/revoke staff by default; `EVENT_MANAGER` may do so only if a later explicit permission is approved

### 3.2 Event and inventory domains

**PrimaryVenue**

- `id`, `organizerId`, `name`, address fields, `timezone`, `accessibilityNotes?`
- venue data is organizer-scoped in Phase 1; no seat maps

**PrimaryEvent**

- The isolated draft-authoring milestone stores `id`, `organizerId`, `title`, `description`, and free-text `category`.
- Until the separately reviewed venue domain exists, draft snapshots store `venueName`, address lines, city, region, postal code, country, and optional accessibility information directly on the event.
- `startsAtLocal` and `endsAtLocal` are wall-clock `TIMESTAMP WITHOUT TIME ZONE` values paired with a required recognized IANA `timezone`. The service accepts ISO local strings without an offset, validates the zone and positive local range, and does not derive a sales/admission instant yet.
- Draft contact fields are `contactEmail` and optional `contactPhone`; `draftPolicyText` is required but has no public or contractual effect.
- The GA capacity foundation adds positive integer `totalCapacity`, editable only through serialized draft-event mutations. It is an allocation ceiling, not an availability or inventory claim.
- The pre-publication lifecycle is `DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED`. This milestone deliberately has no `PUBLISHED` state or discoverability/sales behavior.
- A later reviewed event/inventory milestone may add `venueId`, `doorsAt`, `PUBLISHED | SALES_CLOSED | CANCELLED | COMPLETED`, and the finalized policy/version fields below.
- `refundPolicy`, `cancellationPolicy`, `termsVersion`
- `submittedAt?`, `approvedAt?`, `approvedByUserId?`, `publishedAt?`, `cancelledAt?`, `completedAt?`
- Phase 1 treats one event as one admission performance; a later `PrimaryPerformance` extraction is possible without changing credential claims

**PrimaryTicketType**

- The GA capacity foundation stores organizer/event tenancy, `name`, `description?`, positive `allocatedQuantity`, draft-only `ACTIVE | INACTIVE`, optional positive `minimumPerOrder`/`maximumPerOrder`, recognized ISO currency, and positive integer `basePriceMinor`.
- All types are general admission. Active allocations use one event currency and may never sum above `PrimaryEvent.totalCapacity`; organizer/event/type rows are locked in a consistent order for every capacity or allocation mutation.
- Event submission requires positive capacity and at least one active, positively allocated type. This does not create sellable inventory or make any availability promise.
- `basePriceMinor` is only the draft face-value input. Buyer fees, tax, processor cost, organizer proceeds, and all-in pricing remain uncalculated and unauthorized.
- Future reviewed milestones may add sales windows, price schedule versions, per-buyer limits, and sales states only alongside the inventory/quote design below.

**PrimaryPriceComponentRule**

- `id`, `ticketTypeId`, `code`, `label`, `kind: BASE_PRICE | MANDATORY_FEE | GOVERNMENT_TAX`, `calculation: FIXED_PER_TICKET | FIXED_PER_ORDER | PERCENTAGE`, `value`, `includedInDisplayedPrice`, `refundable`, `priority`, `effectiveAt`, `expiresAt?`
- percentage values use integer basis points; fixed values use integer minor units
- Phase 1 supports fixed per-ticket and fixed per-order mandatory fees plus exclusive percentage/fixed taxes; tax-inclusive pricing, compound/multiple taxes, waived/conditional fees, discounts, donations, add-ons, and buyer-specific pricing are prohibited unless this design is reviewed again
- quote calculation allocates per-order components deterministically across lines/tickets using largest-remainder allocation, with stable ticket ordering as the tie-breaker, so allocated minor units always sum exactly to the order component

**PrimaryOrderPriceComponent** and **PrimaryOrderLinePriceComponent**

- immutable quote snapshots: `id`, order/order-line reference, source rule/version, code, label, kind, calculation basis, quantity/basis points, amount, currency, refundable, allocation method
- unique business keys prevent duplicate snapshots; these rows, rather than current pricing rules, are authoritative for charge, refund, ledger, and reporting calculations

**PrimaryInventoryReservation**

- The isolated reservation foundation stores `id`, `organizerId`, `eventId`, `ticketTypeId`, authenticated `buyerUserId`, positive `quantity`, and `status: HELD | PAYMENT_COMMITTED | RELEASED | EXPIRED`.
- It stores server-clock `expiresAt`, `paymentCommittedAt?`, `reconciliationAfter?`, lifecycle timestamps, and unique idempotency keys for create/commit/release/expire commands.
- `HELD` replaces the design's earlier `ACTIVE` name. A HELD row consumes capacity only while `expiresAt > database-operation clock`; every `PAYMENT_COMMITTED` row consumes capacity regardless of hold expiry.
- The foundation has no order, checkout, price quote, payment provider identifier, or provider operation. `PAYMENT_COMMITTED` is reachable only through an opaque internal capability issued in the isolated test runtime.

Capacity is not represented by one mutable counter alone. During this foundation, reservable quantity is `allocated quantity - unexpired HELD quantity - PAYMENT_COMMITTED quantity`; the same committed quantities across all types must also remain within event capacity. PostgreSQL serializable transactions use the lock order organizer, event, all event ticket types ordered by ID, then all event reservations ordered by ID. The transaction rejects any result exceeding either ticket-type allocation or total event capacity.

In future payment work, immediately before returning a client secret that can produce a delayed success, the server must atomically change `HELD -> PAYMENT_COMMITTED` and set a controlled reconciliation time. The current internal test-only transition models this invariant without creating a PaymentIntent. Expiry can transition only an elapsed HELD reservation and must reject PAYMENT_COMMITTED. Payment-committed inventory remains unavailable until separately reviewed provider reconciliation implements a verified terminal outcome; elapsed time alone never releases it.

### 3.3 Order domain

**PrimaryOrder**

- The provider-free foundation stores `id`, `organizerId`, `eventId`, authenticated `buyerUserId`, unique `reservationId`, currency, face-value subtotal, gross total, and create/prepare idempotency keys. A composite foreign key binds reservation, organizer, event, and buyer at the database boundary.
- Its only current states are `PENDING_PAYMENT | PAYMENT_PROCESSING`. Preparation atomically commits the reservation before advancing the order, persists the material reconciliation-delay command input, and treats reuse against another order/scope/delay as an idempotency conflict.
- Future reviewed payment/fulfilment work may add `PAID | FULFILLED | CANCELLATION_PENDING | CANCELLED | PARTIALLY_REFUNDED | REFUNDED | PAYMENT_FAILED` and the provider/settlement snapshots described elsewhere; those states and fields are not implemented now.

**PrimaryOrderLine**

- The single current line snapshots ticket type, reservation, name, quantity, unit face value, face-value subtotal, and currency. Its composite reservation/type foreign key proves it is the type actually reserved.

**PrimaryOrderPriceComponent**

- Immutable rows store explicit code/label, `FACE_VALUE | MANDATORY_FEE | TAX`, positive amount/currency, stable position, and deterministic quotient/remainder allocation across quantity.
- The service derives FACE_VALUE from the ticket-type snapshot. Additional fee/tax components are internal synthetic configuration only; no permanent business or legal policy is encoded.
- Exact current invariant: `faceValueSubtotalMinor = quantity × unitFaceValueMinor`; `grossTotalMinor = sum(component.amountMinor)`. Every stored quantity, unit amount, component amount, subtotal, and total is at most PostgreSQL `INTEGER` maximum `2,147,483,647`; multiplication is checked in the service and evaluated as `BIGINT` in the database constraint.
- Database triggers make line/component evidence update/delete immutable and prevent changes to an order's financial scope, reservation, currency, totals, create key, and creation timestamp. Only reviewed status/preparation metadata may transition; the future non-owner runtime role must lack `TRUNCATE`.

**PrimaryPayment**

- `id`, `orderId`, `provider`, `providerIntentId`, `status`, amount/currency, `lastProviderEventAt?`
- unique `orderId`, unique `(provider, providerIntentId)`

**PrimaryRefund**

- `id`, `orderId`, `status: REQUESTED | PROCESSING | SUCCEEDED | FAILED | CANCELLED`
- `reason`, `requestedByUserId`, exact amount-component snapshots, `providerRefundId?`, timestamps
- unique `(providerRefundId)` when present; client idempotency key required

**PrimaryRefundItem**

- `id`, `refundId`, `admissionTicketId`, ticket/fee/tax/refund component amounts, `allocationRemainderRank`
- unique `(refundId, admissionTicketId)`; a ticket may belong to only one successful refund
- every partial refund names the exact admission tickets affected; only those credentials are invalidated
- ticket-scoped components refund their stored allocation; per-order refundable components are allocated across all tickets at purchase using largest-remainder rules, so refund order cannot change totals and refunding every ticket exactly equals the original refundable amount

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
- acceptance requires authentication and a verified normalized account email matching `recipientEmailNormalized`; a forwarded token cannot change ownership

**AdmissionScan**

- `id`, `eventId`, `admissionTicketId?`, `credentialId?`, `operatorUserId`, `scannerDeviceId?`
- `result: ACCEPTED | DUPLICATE | VOIDED | REFUNDED | WRONG_EVENT | UNKNOWN | INVALID_SIGNATURE | EXPIRED | UNAUTHORIZED | OVERRIDE_ACCEPTED | OVERRIDE_REJECTED`
- `scannedAt`, `tokenFingerprint`, `reason?`, `overrideOfScanId?`, `overrideReason?`, `supervisorUserId?`
- every attempt is retained; `tokenFingerprint` is non-reversible and supports investigation without storing raw QR tokens

**PrimaryScannerDevice**

- `id`, `organizerId`, `label`, `publicDeviceId`, `status: OBSERVED | REVOKED`, `firstSeenAt`, `lastSeenAt?`, `revokedAt?`, `revokedByUserId?`
- Phase 1 device IDs are telemetry only, never credentials. User session authentication, role, event assignment, CSRF/origin controls, and short scanner-session expiry provide authorization.
- Prototype enrollment means an authorized user names the observed browser/device; revocation blocks that device identifier but does not replace revoking the user/session. Strong device attestation is deferred and must not be claimed.

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
              │                       │                  │                    │
              └──< EventStaffAssignment >───────────────┤                    ├──< PriceComponentRule
                                      └──< PrimaryVenue  └──< Reservation >──┘
                                                            │
User (buyer) ──< PrimaryOrder ──< PrimaryOrderLine ──< PrimaryAdmissionTicket
                       │                                      │
                       ├── PrimaryPayment                     ├──< AdmissionCredential
                       ├──< PrimaryRefund ──< RefundItem >────┤
                       │                                     ├──< AdmissionTransfer
                       └──< OrganizerLedgerEntry              └──< AdmissionScan
```

## 4. State machines and invariants

Invalid transitions return `409 INVALID_STATE`; all accepted transitions are audited.

### Organizer

`DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED`

- Admin may send `UNDER_REVIEW -> REJECTED` or `APPROVED -> SUSPENDED`.
- Applicant may revise `REJECTED -> DRAFT`.
- Only approved organizers may submit events.
- Organizer suspension immediately blocks new event submission/publication, new reservations/sales, staff invitations, and organizer-initiated profile/payment changes. It does not cancel events or invalidate tickets.
- Existing buyers retain ticket/credential access; valid approved events continue scanning; finance/support roles and platform admins can process refunds and buyer support. A separate explicit event suspension/cancellation control is required to stop admission. Emergency platform controls must record which scope was affected and why.

### Event

`DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> SALES_CLOSED -> COMPLETED`

- Admin may return `IN_REVIEW -> DRAFT` with reasons.
- `CANCELLED` is reachable from `APPROVED`, `PUBLISHED`, or `SALES_CLOSED`. Cancellation immediately closes inventory, invalidates admission, records refund obligations/liabilities, and creates refund workflows. It does **not** record cash refund reversals before provider confirmation.
- Each provider-confirmed refund creates the corresponding cash/refund reversal entries. Pending and failed obligations remain open and visible in reconciliation until resolved; cancellation completion is not inferred from requested refunds.
- Publication requires organizer approval, event approval, at least one valid ticket type, coherent sale dates, and inventory not exceeding capacity.

### Order and reservation

`HELD reservation -> PAYMENT_COMMITTED -> CONSUMED` is the future successful path.

- `ACTIVE` may become `EXPIRED` or `RELEASED` before a payment-capable attempt begins.
- `PAYMENT_COMMITTED` continues to consume capacity even after `expiresAt`. Only a verified terminal failure/cancellation can release it.
- A reconciliation timeout never assumes failure from elapsed time alone. It queries Stripe; ambiguous/unavailable results move to `EXCEPTION` and retain capacity.
- A delayed success for a committed reservation consumes the held inventory normally. If corrupted state or an invariant violation makes fulfilment impossible, the webhook creates an operational exception and automatic full-refund obligation, issues no credential, and never silently oversells.

`PENDING_PAYMENT -> PAYMENT_PROCESSING -> PAID -> FULFILLED`

- Payment failure returns to `PENDING_PAYMENT` while the reservation is valid, otherwise `PAYMENT_FAILED`.
- `PAID/FULFILLED -> CANCELLATION_PENDING -> REFUNDED` for a complete refund.
- Partial ticket refunds produce `PARTIALLY_REFUNDED`, identify exact `PrimaryAdmissionTicket` rows through `PrimaryRefundItem`, invalidate only those tickets, and use their purchase-time component allocations. Retained tickets remain active and all component totals must reconcile exactly.
- Credentials are issued only after a verified, idempotently processed `payment_intent.succeeded` event.

### Credential and transfer

- Issuance creates ticket `ISSUED` plus generation 1 credential `ACTIVE` atomically.
- Starting transfer changes ticket to `TRANSFER_PENDING`; current credential remains usable until acceptance unless product/legal review chooses immediate suspension.
- Accepting transfer atomically marks the old credential `SUPERSEDED`, changes ownership, creates the next credential generation, and sets the ticket `TRANSFERRED`.
- Void/refund atomically invalidates the active credential and marks the entitlement accordingly.
- No transition restores an invalidated credential. Reissue always creates a new generation.
- `CHECKED_IN` is terminal for buyer-facing use: transfer, ordinary reissue, and regeneration as an unused ticket are prohibited. A post-entry void/refund may be recorded only by an authorized box-office/finance/admin workflow; it preserves `checkedInAt` and the accepted scan, never creates a usable credential, and records the financial/support outcome separately.

### Scan

- Scan service authenticates staff, verifies event assignment and role, verifies signature/key, loads the credential by hash, and checks event/status.
- First acceptance uses one database transaction with a conditional update such as `status = ACTIVE`. Exactly one concurrent scan can change it to `CHECKED_IN`; later attempts are `DUPLICATE`.
- Each attempt creates an `AdmissionScan`, including rejects. Override requires `BOX_OFFICE` or `OWNER`, a non-empty reason, and a linked audit event.

### Refund

`REQUESTED -> PROCESSING -> SUCCEEDED` or `FAILED`; failed requests can be retried through a new provider attempt while preserving the original record/history.

- Success is driven by a signed Stripe webhook, not the browser response.
- A successful full refund invalidates all unscanned order credentials and creates exact reversing ledger entries in one idempotent transaction. Previously checked-in tickets retain their immutable entry history and remain unusable; whether post-entry refunds are permitted is a policy decision.
- Event cancellation creates refund obligations, not successful-refund entries. Provider-confirmed results settle those obligations individually; pending/failed amounts remain explicit liabilities.

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

`PrimaryEventStaffAssignment` is the required event-scope grant defined in section 3.1. Owner and platform-admin bypasses are explicit and audited; every other operational role requires an active assignment.

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

### Retention and redaction requirements

Before pilot approval, legal/privacy owners must approve a documented retention schedule. Until then, the preview keeps only synthetic data and uses conservative configurable defaults: rejected scan attempts and token fingerprints 90 days after event completion; IP hashes 30 days; expired/revoked invitation and transfer records 90 days; webhook delivery metadata seven years if classified as a financial audit record, otherwise one year; attendee/order records seven years if legally required for accounting, with non-required personal fields deleted or de-identified earlier.

Raw QR tokens, invitation/transfer bearer tokens, full IP addresses, complete webhook payloads, card data, and secrets are never retained. Audit before/after JSON passes through an allowlist redactor. Retention jobs are idempotent, auditable, tenant-aware, preserve active legal holds, and delete or irreversibly de-identify only the permitted fields. These durations are placeholders, not policy, and must be replaced by approved Canadian legal/privacy requirements before real pilot data.

## 7. Payment and financial flow proposal

Phase 1 uses Stripe test mode and separate primary Stripe environment variables. It must not reuse production Stripe objects or silently fall back to existing secondary-payment keys.

### Authoritative retry-safe checkout sequence

1. **Quote:** the server calculates versioned price components. The first meaningful display includes base price and every mandatory non-government fee; tax is separately identified where required. A quote key makes retries deterministic.
2. **Reserve and order:** serialized transactions create or reuse the HELD reservation, then bind one PENDING_PAYMENT order and immutable line/component snapshots to it. A browser disappearing here leaves an expirable HELD reservation.
3. **Create provider attempt:** the server creates or retrieves exactly one Stripe test PaymentIntent using a provider idempotency key derived from the primary order and attempt number. Before returning its client secret, one transaction verifies the amount, currency, and provider reference and changes the reservation to PAYMENT_COMMITTED and order to PAYMENT_PROCESSING. If provider creation succeeds but the local commit or response fails, a retry retrieves the same PaymentIntent and completes the local transition.
4. **Client payment:** the browser confirms the PaymentIntent. Browser success or failure is advisory; it never fulfils an order or releases inventory.
5. **Webhook:** the dedicated endpoint verifies its dedicated signature, claims the provider event, and processes it once. Success validates order, amount, currency, intent, and committed capacity, then atomically consumes inventory, records capture ledger entries, and issues credentials. An idempotent outbox sends receipts after commit.
6. **Terminal failure/cancellation:** a verified Stripe terminal state returns committed inventory to sale and marks the order failed or cancelled. A retryable state remains committed.
7. **Abandonment/timeout:** a HELD reservation expires normally. A PAYMENT_COMMITTED reservation is never time-expired blindly. After its resolution deadline, a worker retrieves Stripe state and releases only a proven terminal failure/cancellation, fulfils a proven success, or moves ambiguity to EXCEPTION while retaining capacity and alerting operations.
8. **Late success:** a delayed success consumes the inventory that remained committed. If corrupted state or an invariant breach makes fulfilment impossible, the system issues no credential and creates an operational exception plus an idempotent automatic full-refund obligation.
9. **Refund:** the request names exact tickets, creates or reuses a local refund intent from its idempotency key, and calls Stripe with a derived provider key. Only a signed provider-success event posts cash/refund reversals and invalidates the selected credentials.
10. **Reconciliation:** a scheduled test-only process compares local attempts and deliveries against Stripe, repairs safe missing terminal processing idempotently, and reports every ambiguous order/refund for manual review.

### Financial definitions and invariants

Gross platform revenue means platform fees before processor costs, reserves, chargebacks, refunds, or adjustments. Processor fees are expenses and are never hidden inside platform revenue. Reserve holds are balance-sheet restrictions, not revenue or expense.

```text
gross captured = ticket subtotal + mandatory fees + government taxes
gross captured = gross organizer revenue + gross platform revenue + tax liability

net cash after provider activity
  = gross captured - confirmed refunds - processor fees - chargebacks +/- cash adjustments

net organizer payable
  = gross organizer revenue
    - organizer-allocated confirmed refunds
    - organizer-allocated processor fees
    - organizer-allocated chargebacks
    - reserve holds + reserve releases
    +/- organizer adjustments

net platform position
  = gross platform revenue
    - platform-allocated confirmed refunds
    - platform-allocated processor fees
    - platform-allocated chargebacks
    +/- platform adjustments

net cash after provider activity
  = net organizer payable + reserve balance + net platform position + remaining tax liability
```

Every equation must reconcile from append-only component ledger entries. Refund obligations created by cancellation are reported separately from confirmed cash refunds. The precise allocation of processor fees, reserves, tax, platform fees, and chargebacks remains configurable and blocked on business/legal decisions.

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
- Reservation expiry: compare the server-owned operation clock and expire only `HELD` rows. Never release `PAYMENT_COMMITTED` or future `EXCEPTION` capacity without verified provider resolution.
- Payment/refund webhooks: unique provider event claim plus idempotent domain-operation keys.
- Credential issuance/rotation: unique ticket-generation keys and conditional invalidation inside one transaction.
- Scan: conditional `ACTIVE -> CHECKED_IN` update and attempt record in one transaction.
- Ledger: unique business-event idempotency keys; no updates/deletes.
- Reporting: reconcile order snapshots, Stripe test balance events, credential counts, inventory, refunds, and ledger sums. Any mismatch is visible and blocks statement finalization.

## 12. Test and verification plan

Before pilot review, automated tests must prove:

- concurrent reservations/checkouts cannot exceed ticket-type or event capacity;
- expired reservations return inventory;
- payment-committed inventory cannot expire or be resold while Stripe can still succeed;
- delayed success consumes committed capacity; impossible fulfilment creates an exception and automatic refund obligation without issuing a credential;
- Stripe webhook replay changes state and ledger exactly once;
- first scan succeeds and concurrent/subsequent scans are duplicates;
- transfer acceptance supersedes the old credential;
- invitation and transfer acceptance require authenticated control of the matching verified email;
- checked-in tickets cannot be transferred, reissued, or regenerated as unused;
- refunded/voided/cancelled credentials fail admission;
- wrong-event and invalid-signature tokens fail;
- scanner and box-office staff cannot access unassigned events;
- device identifiers alone grant no scanner access, and revoked devices/sessions are rejected;
- Organizer A cannot access Organizer B data through direct IDs or list filters;
- organizer suspension blocks new sales/publication while preserving buyer ticket access, valid-event scanning, refunds, and support;
- all mandatory non-government fees are present from the first price display;
- per-order fee/tax allocation and partial refunds reconcile to exact ticket/component amounts under all rounding cases;
- event cancellation records liabilities immediately but cash reversals only after provider-confirmed refunds;
- order, refund, ledger, and statement components reconcile exactly;
- feature-off primary pages/APIs/webhooks/jobs are unavailable;
- no primary path accepts secondary `Ticket`/`Order` records;
- no production credential names, keys, hosts, Stripe objects, emails, or data appear in fixtures/configuration;
- the complete existing secondary-marketplace suite remains green.

Add service-level integration tests against PostgreSQL for locking/constraints; mocked unit tests alone are insufficient for inventory and scan atomicity. Add a Stripe CLI test-mode replay drill and a manual online scanner drill using two devices.

## 13. Deliberately narrow next approval

Even after this design revision is approved, the next authorization should cover only:

1. server-side feature gate and environment preflight;
2. primary module skeleton;
3. organizer, membership, invitation, and event-assignment models;
4. tenant authorization guards;
5. audit and transactional-outbox foundations; and
6. tests proving feature-off unavailability and cross-tenant denial.

That foundation milestone explicitly excludes event inventory, reservations, checkout, Stripe, credentials, QR generation, transfers, scanning, refunds, ledger/settlement, reports, production migrations, live deployment, and real data. Each excluded domain requires its own implementation review before work begins.

Every authorized milestone requires code, migration limited to the isolated environment, automated tests, update document, preview evidence where applicable, risks, open decisions, and exact verification results. No migration is authorized by this document alone.

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
