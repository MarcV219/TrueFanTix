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

- The single current line snapshots ticket type, reservation, name, quantity, unit face value, face-value subtotal, and currency. Composite keys prove both that its reservation/type pair is valid and that its order/reservation pair matches the parent order.

**PrimaryOrderPriceComponent**

- Immutable rows store explicit code/label, `FACE_VALUE | MANDATORY_FEE | TAX`, positive amount/currency, stable position, and deterministic quotient/remainder allocation across quantity.
- Each component's `(orderLineId, orderId)` must reference one matching line/order pair, preventing a component from naming another order's line.
- The service derives FACE_VALUE from the ticket-type snapshot. Additional fee/tax components are internal synthetic configuration only; no permanent business or legal policy is encoded.
- Exact current invariant: `faceValueSubtotalMinor = quantity × unitFaceValueMinor`; `grossTotalMinor = sum(component.amountMinor)`. Every stored quantity, unit amount, component amount, subtotal, and total is at most PostgreSQL `INTEGER` maximum `2,147,483,647`; multiplication is checked in the service and evaluated as `BIGINT` in the database constraint.
- Database triggers make line/component evidence update/delete immutable and prevent changes to an order's financial scope, reservation, currency, totals, create key, and creation timestamp. Only reviewed status/preparation metadata may transition; the future non-owner runtime role must lack `TRUNCATE`.

**PrimaryPayment**

- `id`, `orderId`, `provider`, `providerIntentId`, `status`, amount/currency, `lastProviderEventAt?`
- unique `orderId`, unique `(provider, providerIntentId)`
- The isolated foundation realizes this boundary as scoped `PrimaryPaymentAttempt`, deduplicated `PrimaryPaymentProviderEvent`, and explicit `PrimaryPaymentException` evidence. It creates only unconfirmed Stripe test-mode intents after the local committed transaction and exposes no client secret or checkout route.
- Webhook success is fail-closed against immutable amount/currency and server-owned order/organizer/event/reservation metadata. A released-inventory late success creates a refund-required exception rather than tickets; terminal failure release requires a signed event explicitly carrying the adapter's terminal guarantee.

**PrimaryRefund (design only)**

- `id`, exact organizer/event/order/payment scope, `status: REQUESTED | PROVIDER_PENDING | SUCCEEDED | FAILED | RECONCILIATION_REQUIRED | CANCELLED_BEFORE_PROVIDER`
- `SUCCEEDED`, `FAILED`, and `CANCELLED_BEFORE_PROVIDER` are terminal parent states. An attempt-level terminal failure does not by itself make the parent `FAILED` while an authorized retry remains possible.
- `reason`, `requestedByUserId`, command/allocation digest, immutable item/component snapshots, timestamps
- provider identifiers live on append-only provider-attempt evidence; globally unique platform request key required

**PrimaryRefundItem**

- `id`, `refundId`, `admissionTicketId`, ticket/fee/tax/refund component amounts, `allocationRemainderRank`
- unique `(refundId, admissionTicketId)`; database guards prevent one ticket/allocation from belonging to overlapping pending or successful refunds
- every partial refund names the exact admission tickets affected; only those credentials are invalidated
- ticket-scoped components refund their stored allocation; per-order refundable components are allocated across all tickets at purchase using largest-remainder rules, so refund order cannot change totals and refunding every ticket exactly equals the original refundable amount

**PrimaryWebhookDelivery**

- `id`, `provider`, `providerEventId`, `eventType`, `payloadHash`, `receivedAt`, `processedAt?`, `status`, `error?`
- unique `(provider, providerEventId)` prevents replay

### 3.4 Admission domain

**PrimaryAdmissionTicket**

- `id`, `orderLineId`, `eventId`, `ticketTypeId`, `ownerUserId`, `sequenceWithinLine`
- Admission-usability status is independent from financial refund status. The implemented admission states remain `ISSUED | VOIDED | CHECKED_IN`; transfer/reissue states require a later design.
- `issuedAt`, `voidedAt?`, `checkedInAt?`; refund request/provider/cash state lives only on refund records and never changes admission back to `ISSUED`
- unique `(orderLineId, sequenceWithinLine)`

This is the durable entitlement. It is deliberately not the existing secondary `Ticket` model.

The isolated credential foundation implements only `ISSUED -> VOIDED`, one credential generation, and internal synthetic issuance/verification. It binds entitlement scope to the exact paid order/line/reservation/ticket type with composite foreign keys and creates exactly one entitlement per line unit. A database INSERT guard independently enforces line quantity and PAID + SUCCEEDED + no-exception eligibility. The PII-free canonical Ed25519 v1 payload contains exactly credential UUID, event ID, issuance time, and test key ID plus its version. Stored evidence excludes the signature, so database read access alone cannot reconstruct the bearer token; authorized replay deterministically re-signs with the protected key. No QR presentation, transfer, reissue, scan, check-in, refund, public route, or browser surface is included at this milestone.

The isolated online scan foundation adds service-level `ISSUED -> CHECKED_IN` only. It uses a test public-key keyring so retired issuer public keys can verify historical credentials without retaining old private keys. Every accepted entry is serialized on the entitlement and atomically records append-only scan plus audit/outbox evidence; concurrent and later scans are duplicates. Event-day access requires an active exact-event assignment and an active `OWNER`, `EVENT_MANAGER`, `BOX_OFFICE`, or `SCANNER` membership, including for owners, with no platform-admin bypass. Authenticated invalid attempts retain only minimal expected-event/operator evidence when no entitlement can safely be identified. This is an online-only claim: routes, UI, QR presentation, overrides, offline sync, transfer, reissue, refunds, and check-in reversal remain deferred.

Scan commands are idempotent by a globally unique normalized request ID plus a SHA-256 digest of all material scope/device inputs and a SHA-256 bearer-token digest. Exact response-delivery retries return the original accepted or rejected result without new evidence; changed-input reuse conflicts. The database independently enforces result/binding/state consistency before immutable scan evidence is inserted.

A partial unique database index permits exactly one `ACCEPTED` evidence row per entitlement. `DUPLICATE` evidence is valid only after an accepted row exists for the same exact ticket, credential, and event; a direct ticket-state change alone cannot manufacture a plausible duplicate history.

**AdmissionCredential**

- `id` generated from cryptographically secure random bytes, not a sequential identifier
- `admissionTicketId`, `eventId`, `generation`, `tokenHash`, `keyId`
- Credential usability mirrors the owning admission ticket and revocation evidence; refund finance is never a credential status. The implemented generation is usable only while its ticket is `ISSUED`, and is unusable when the ticket is `VOIDED` or `CHECKED_IN`.
- `issuedAt`, `expiresAt?`, `invalidatedAt?`, `invalidationReason?`
- unique `(admissionTicketId, generation)`, unique `tokenHash`
- only one active generation per ticket, enforced in the credential-rotation transaction

**AdmissionTransfer**

- `id`, `admissionTicketId`, `fromUserId`, `recipientEmailNormalized`, `toUserId?`
- `status: PENDING | ACCEPTED | EXPIRED | CANCELLED`, `tokenHash`, timestamps
- acceptance requires authentication and a verified normalized account email matching `recipientEmailNormalized`; a forwarded token cannot change ownership

**AdmissionScan**

- `id`, `eventId`, `admissionTicketId?`, `credentialId?`, `operatorUserId`, `scannerDeviceId?`
- `result: ACCEPTED | DUPLICATE | VOIDED | WRONG_EVENT | UNKNOWN | INVALID_SIGNATURE | EXPIRED | UNAUTHORIZED | OVERRIDE_ACCEPTED | OVERRIDE_REJECTED`; a refund-related rejection is `VOIDED` because admission usability and refund finance are separate
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

- `HELD` may become `EXPIRED` or `RELEASED` before a payment-capable attempt begins.
- `PAYMENT_COMMITTED` continues to consume capacity even after `expiresAt`. Only a verified terminal failure/cancellation can release it.
- A reconciliation timeout never assumes failure from elapsed time alone. It queries Stripe; ambiguous/unavailable results move to `EXCEPTION` and retain capacity.
- A delayed success for a committed reservation consumes the held inventory normally. If corrupted state or an invariant violation makes fulfilment impossible, the webhook creates an operational exception and automatic full-refund obligation, issues no credential, and never silently oversells.

`PENDING_PAYMENT -> PAYMENT_PROCESSING -> PAID -> FULFILLED`

- Payment failure returns to `PENDING_PAYMENT` while the reservation is valid, otherwise `PAYMENT_FAILED`.
- Order-level `PARTIALLY_REFUNDED`/`REFUNDED` may be derived financial summaries only after provider-confirmed refund outcomes; they do not replace admission-ticket state. Exact progress remains authoritative on refund, attempt, item, and allocation evidence.
- Partial ticket refunds identify exact `PrimaryAdmissionTicket` rows through `PrimaryRefundItem`, terminally void those unscanned tickets before provider work, and use purchase-time component allocations. Retained tickets keep their existing admission state and all component totals must reconcile exactly.
- Credentials are issued only after a verified, idempotently processed `payment_intent.succeeded` event.

### Credential and transfer

- Issuance creates ticket `ISSUED` plus generation 1 credential `ACTIVE` atomically.
- Starting transfer changes ticket to `TRANSFER_PENDING`; current credential remains usable until acceptance unless product/legal review chooses immediate suspension.
- Accepting transfer atomically marks the old credential `SUPERSEDED`, changes ownership, creates the next credential generation, and sets the ticket `TRANSFERRED`.
- A non-refund void transitions an eligible admission ticket to `VOIDED`. A refund request uses that same terminal admission transition before provider work, while refund status remains exclusively on financial records.
- No transition restores an invalidated credential. Reissue always creates a new generation.
- `CHECKED_IN` is terminal for buyer-facing use: transfer, ordinary reissue, and regeneration as an unused ticket are prohibited. Until checked-in refund authority and cost-bearing policy are approved, a post-entry request creates policy-review/obligation evidence only and makes no provider call; it preserves `checkedInAt` and the accepted scan and never creates a usable credential.

### Scan

- Scan service authenticates staff, verifies event assignment and role, verifies signature/key, loads the credential by hash, and checks event/status.
- First acceptance uses one database transaction with a conditional update such as `status = ACTIVE`. Exactly one concurrent scan can change it to `CHECKED_IN`; later attempts are `DUPLICATE`.
- Each attempt creates an `AdmissionScan`, including rejects. Override requires `BOX_OFFICE` or `OWNER`, a non-empty reason, and a linked audit event.

### Refund

Refund finance uses `REQUESTED -> PROVIDER_PENDING`; the parent remains `PROVIDER_PENDING` across authentically terminal-failed provider attempts while policy still permits an authorized retry. It reaches terminal `SUCCEEDED` on confirmed cash reversal, terminal `FAILED` only through an explicit reviewed abandonment/finality decision, or terminal `CANCELLED_BEFORE_PROVIDER` only after proof that no provider request was sent. `RECONCILIATION_REQUIRED` is a fail-closed nonterminal operational state that may return only to `PROVIDER_PENDING` after reviewed reconciliation; it cannot authorize a fresh provider identity by itself. Admission usability is separate: an eligible unscanned `ISSUED` ticket is atomically and terminally changed to `VOIDED` before any provider call. Provider failure or ambiguity never resurrects its credential.

- Success is driven by a signed Stripe webhook or an authenticated provider reconciliation read, never a browser response.
- A successful full refund confirms the already-voided ticket selection and creates exact cash/reversal evidence in one idempotent transaction. Previously checked-in tickets retain immutable entry history; whether a post-entry cash refund is permitted remains a mandatory policy decision.
- Event cancellation creates refund obligations, not successful-refund entries. Provider-confirmed results settle those obligations individually; pending, failed, and ambiguous amounts remain explicit liabilities.

### 4.1 Refund, event-cancellation, and admission-revocation design gate

#### Provisional policy package v1 (approved 2026-09-11)

These defaults are immutable, versioned inputs to new obligations. They apply prospectively; a later policy version never rewrites a purchase allocation, refund, cancellation generation, liability, revocation, accounting entry, notice, or retention decision created under an earlier version. Legal, accounting, and operations review remains required before live use.

- The organizer is the merchant and contractual seller for ticket revenue and organizer-controlled components. TrueFanTix owns only a separately disclosed `TRUEFANTIX_ADMIN_FEE`; a generic service fee is not silently reclassified as a platform fee.
- Each party bears refunds and losses for its own component. The organizer bears ticket value, organizer fees, organizer-caused cancellation exposure, processor costs, and applicable tax corrections. TrueFanTix bears its disclosed admin-fee component and documented TrueFanTix-caused errors only.
- `CHECKED_IN` refunds require supervised exception review with preserved admission evidence, explicit authority, fraud review, reason, evidence, and loss-bearer selection. There is no automatic post-entry refund.
- Organizer contracts require event-performance/refund indemnity and appropriate event-cancellation insurance. Cancellation obligations remain organizer liabilities until confirmed cash reversal or an authorized documented waiver.
- Organizer net proceeds remain held through event completion and a separately configured clearance period, subject to open refunds/disputes, risk-based reserves, and negative-balance recovery. This milestone records policy and liabilities only; it does not execute payouts or reserves.
- Refund/void never returns a unit automatically to inventory. Any later authorized resale requires a newly issued, versioned credential; the original credential remains permanently unusable.
- TrueFanTix administers provider evidence and reconciliation. The organizer bears chargeback principal and fees except for a documented TrueFanTix-caused error; late or contradictory provider evidence is append-only and reviewed.
- Accounting evidence is immutable. Buyer notices and tax corrections must be clear; access is least-privilege; legal holds override expiry; retention expiry deletes or de-identifies non-required data. The organizer is controller for attendee/event-commerce data and TrueFanTix is processor/service provider, except for TrueFanTix account, fraud, security, and compliance purposes.

Persistence policy identifier `primary-refund-policy-v1` binds the normalized package and SHA-256 policy digest. Existing isolated synthetic components are fail-closed materialized as refundable under v1 and organizer-owned unless their immutable code is exactly `TRUEFANTIX_ADMIN_FEE`; no mutable label or current price is used to infer ownership.

This section is a design contract only. It authorizes no schema, migration, provider call, route, ledger posting, or credential mutation. Implementation remains blocked until Marc, legal, accounting, and operations decide the items identified below.

#### Proposed records and immutable boundaries

- `PrimaryRefund`: one buyer, staff, cancellation, chargeback, or reconciliation request scoped to the exact organizer/event/order/payment attempt. Proposed transitions are `REQUESTED -> PROVIDER_PENDING`, `PROVIDER_PENDING <-> RECONCILIATION_REQUIRED`, and either active state to terminal `SUCCEEDED` or explicitly abandoned `FAILED`; `REQUESTED -> CANCELLED_BEFORE_PROVIDER` is allowed only with proof no request was sent. `SUCCEEDED`, `FAILED`, and `CANCELLED_BEFORE_PROVIDER` never transition and reject every later attempt authorization.
- `PrimaryRefundProviderAttempt`: append-only provider request evidence with its own platform-derived idempotency key, expected amount/currency, provider refund ID when attached, request timing, transport disposition, last verified provider state, and terminal evidence. Transport states distinguish `NOT_SENT`, `SEND_UNCERTAIN`, `PROVIDER_ATTACHED`, `TERMINAL_FAILED`, and `SUCCEEDED`. A failed attempt is never overwritten.
- `PrimaryRefundItem`: immutable exact ticket selection. A full-order refund materializes every refundable ticket as an item rather than relying on an order-level boolean. A ticket cannot participate in more than one pending or successful refund allocation for the same captured funds.
- `PrimaryRefundAllocation`: immutable per-item, per-purchase-component allocation containing component ID/code/kind, original allocated minor units, requested refundable minor units, currency, remainder rank, and policy/version evidence. Refund calculations never consult mutable current pricing.
- `PrimaryEventCancellation`: one event-scoped cancellation decision with requested/activated times, actor, non-empty reason, policy version, and states `REQUESTED -> ACTIVE -> REFUNDING -> RESOLVED | RECONCILIATION_REQUIRED`. Activation and financial resolution are distinct facts.
- `PrimaryRefundObligation`: append-only liability created by cancellation, late-success exception, chargeback resolution, or another reviewed cause. Proposed states are `OPEN -> REFUND_LINKED -> SATISFIED | WAIVED_WITH_APPROVAL | RECONCILIATION_REQUIRED`. Only a provider-confirmed refund can satisfy a cash-refund obligation.
- `PrimaryAdmissionRevocation`: append-only evidence naming the exact ticket/credential, cause, actor/system source, reason/policy reference, refund/cancellation link, and effective time. Entitlement and credential scope remain immutable; revocation is never represented by deleting or rewriting issuance or scan evidence.
- Provider events, refund attempts, allocations, obligations, revocations, and audit evidence are append-only. Mutable aggregate status fields may move only through explicit database-enforced transitions. Composite keys must bind every child to the same organizer, event, order, payment attempt, ticket, credential, buyer, amount, and currency scope.

#### Refund command and provider state machine

1. A request names either the complete paid order or an explicit non-empty set of its admission-ticket IDs. The service reloads current actor and financial state, locks organizer -> event -> order -> payment attempt -> ordered tickets -> any existing refund items, and calculates the command solely from immutable snapshots.
2. One serializable local transaction validates eligibility, reserves a globally unique platform request key, materializes exact items/allocations, changes each eligible unscanned admission ticket from `ISSUED` to terminal `VOIDED`, creates immutable revocation plus audit/outbox evidence, and commits. `REQUESTED`/`PROVIDER_PENDING` are refund-record states, not admission-ticket states. No Stripe call occurs before this commit.
3. `VOIDED` is immediately fail-closed for admission. A provider failure or ambiguous result changes only refund/attempt financial state and never restores the prior credential. Any future restoration requires an independently reviewed reissue design and a new credential, never resurrection of the revoked credential.
4. After local commit, the adapter creates or retrieves a Stripe test-mode refund using a platform-owned key bound to refund ID, payment intent/charge, amount, currency, selected items, allocation digest, and attempt number. Changed reuse conflicts before provider work.
5. Browser/provider synchronous responses are advisory. Only a verified signed provider event or authenticated reconciliation read can confirm `SUCCEEDED`, establish attempt-level `TERMINAL_FAILED`, or move the parent between `PROVIDER_PENDING` and `RECONCILIATION_REQUIRED`. Attempt-level failure leaves the parent `PROVIDER_PENDING` if another attempt remains policy-eligible.
6. Success atomically confirms exact provider ID, amount, currency, original payment, order, and refund metadata; marks the refund/items financially `SUCCEEDED`, leaves the affected admission tickets terminally `VOIDED`, satisfies linked obligations, and writes cash-confirmation/audit/outbox evidence. Mismatch fails closed to reconciliation and does not claim cash reversal.
7. Provider dispatch is classified before any retry: a local/transport failure proven to occur before send remains `NOT_SENT` and may retry with the exact same provider idempotency identity; a timeout, disconnect, or indeterminate response after dispatch is `SEND_UNCERTAIN` and forbids a new provider identity; a returned provider refund is `PROVIDER_ATTACHED`; only authenticated provider evidence can establish `TERMINAL_FAILED` or `SUCCEEDED`.
8. A retry after `NOT_SENT` reuses the same provider idempotency identity. `SEND_UNCERTAIN` and `PROVIDER_ATTACHED` must reconcile by that same identity until Stripe proves success or terminal failure; neither may create a new attempt that could double-refund. A new attempt/identity is allowed only while the parent remains `PROVIDER_PENDING`, after authenticated reconciliation proves the preceding attempt `TERMINAL_FAILED` and incapable of later success, plus explicit authorization and a non-empty reason. One serializable authorization transaction locks the parent and prior attempts, verifies no next attempt already exists, and creates exactly one next ordinal/key plus audit/outbox evidence; concurrent or changed-command authorization conflicts without residue.
9. Moving the parent to `FAILED` is a separate reviewed abandonment/finality command requiring a non-empty reason and proof that no attempt is uncertain, attached, or capable of later success. Once the parent is `SUCCEEDED`, `FAILED`, or `CANCELLED_BEFORE_PROVIDER`, it cannot create another provider attempt or change terminal state.
10. Duplicate, reordered, changed-content, or late provider events use durable provider-event identity plus payload/material digest. Exact replay is a no-op; changed-content reuse conflicts. A late success after a nonterminal local observation completes the same refund exactly once. Contradictory evidence received after terminal success remains append-only and escalates without changing the terminal parent or reversing success.
11. Partial provider success is not inferred. If Stripe cannot atomically refund the exact requested amount, the refund remains pending/reconciliation-required. Local items are not partially marked from an unverified aggregate response.

#### Exact allocation and rounding

- Before refund implementation, every immutable purchase component must have a reviewed `refundable` disposition and policy version. The current `FACE_VALUE`, `MANDATORY_FEE`, and `TAX` names do not by themselves decide refundability, tax treatment, or who bears the reversal.
- At purchase snapshot time, each component's integer minor units are allocated across ticket units deterministically: quotient to every unit, then one remainder unit in stable `(orderLineId, unitNumber, componentId)` order. The stored per-ticket allocations must sum exactly to the original component and gross order totals.
- A ticket-level refund is the sum of that ticket's stored refundable allocations. A full-order refund is the sum across the materialized ticket set. Selection order and refund timing cannot change amounts, and refunding every ticket exactly equals the original refundable total.
- Currency is inherited from the immutable order and must match provider currency. No floating point, recomputation from current prices, client totals, or cross-currency refund is permitted.
- Previously refunded/pending allocations are subtracted by exact component identity under lock. Requested cumulative refunds must never exceed captured gross or any original component allocation.
- Processor fees, non-refundable fees, tax adjustments, goodwill payments, chargebacks, and post-entry exceptions require distinct typed allocations. They must not be hidden by modifying face value or rounding residue.

#### Existing isolated-order allocation materialization

- The first future refund migration must materialize per-ticket component allocations for every existing synthetic paid order before enabling any refund command. It reads only immutable order lines/components and admission unit numbers, never current ticket-type prices or mutable pricing rules.
- For each component, the migration applies the same quotient/remainder algorithm in stable `(orderLineId, unitNumber, componentId)` order, records the source component and algorithm/version, and stores an allocation-set digest. A database guard must prove per-component allocations sum exactly to the immutable component amount and all component totals reconcile to the order gross total.
- Materialization is idempotent by immutable source component plus ticket unit and must produce the same digest on replay. Existing refund/provider work remains disabled until every eligible order has a complete, uniquely bound allocation set.
- Missing admission units, unsupported component semantics, inconsistent quantities/currencies, overflow, or any reconciliation mismatch aborts the migration/transaction for that order and places it on an explicit remediation report. The process must fail closed rather than infer refundability, invent a split, or recompute from mutable prices.
- Migration `20260911112339_add_primary_refund_persistence_foundation` realizes this only for isolated synthetic data. `materialize_primary_purchase_allocations(orderId)` verifies exact unit cardinality before writing, uses integer quotient/remainder in stable line/unit/component order, binds every row to policy v1, persists one deterministic component-set digest, reconciles every source component exactly, and is idempotent on replay. The migration invokes it for each existing paid isolated order and aborts the migration if any order is incomplete or inconsistent.
- Refund Persistence Revision 1 validates each order line independently and allocates only that line's components across that line's exact admission units. The database now permits multiple immutable lines per order and uses `(orderLineId, unitNumber)` as the entitlement-unit identity. Mixed quantities cannot be combined into one scalar cardinality check.

#### Persistence-integrity gates

- Inserting a refund item atomically claims its admission ticket in `PrimaryRefundTicketClaim`. The ticket primary key is the concurrency boundary: two transactions cannot claim the same ticket even if both began before either could observe the other's refund item.
- `REQUESTED -> PROVIDER_PENDING` calls a database completeness assertion under the parent lock. Item totals must equal the parent request, each item's allocation total must equal the item, and the aggregate allocation total must equal the request. Item/allocation creation is restricted to `REQUESTED` and takes that same parent lock; the gate, child writes, and attempt authorization therefore serialize. Each purchase allocation is also locked while cumulative use is checked. A provider attempt must exactly equal the reconciled parent amount/currency.
- A `CHECKED_IN` ticket cannot become a refund item unless a prior immutable `PrimaryCheckedInRefundApproval` binds that exact refund/ticket, evidence digest, reason, fraud review, explicit `ORGANIZER | TRUEFANTIX` cost bearer, and a current verified non-banned platform admin or active `OWNER`/`FINANCE` member of the exact organizer. Buyers, unprivileged members, and cross-organizer staff cannot approve. Unscanned tickets do not require this exception record.
- Activation replaces caller-proposed cancellation expectations with an immutable `PrimaryCancellationSnapshotTicket` set derived from actual event tickets and refundable purchase allocations under the bound policy. Missing allocation evidence fails closed. Caller counter edits are rejected. Immutable batch-ticket rows must exactly match a snapshot ticket, range, amount, currency, and order-scoped obligation. Cumulative claims serialize on the obligation and cannot exceed it; `RESOLVED` requires exact snapshot, batch, generation, and per-obligation coverage. A partial unique index permits at most one active/refunding/reconciliation generation per event.
- `WAIVED_WITH_APPROVAL` requires prior immutable named approval from the same scoped supervisor set, with evidence digest and reason. If a batch-ticket claim names refund evidence, that item must belong to the refund explicitly linked by its cancellation obligation and must match cancellation/order/event/organizer/policy/currency/ticket/amount scope; an unrelated voluntary refund cannot satisfy cancellation coverage. Independent foreign keys remain supplemented by insertion guards across the other aggregate identities.
- Cancellation snapshot insertion is database-internal to activation; callers cannot pre-seed it. Every later cancellation child insert (batch, obligation, batch-ticket claim, waiver approval, revocation, or refund link) locks the same cancellation row as the `RESOLVED` transition and requires an active unresolved state. Resolution is therefore stable against both later and concurrent evidence appends.
- A refund may represent cancellation causation only through an immutable `PrimaryCancellationRefundLink` created while the cancellation is active and the refund is still empty and `REQUESTED`. The link locks both parents and proves organizer/event/policy scope before item materialization or provider authorization, preventing retroactive relabeling. A linked obligation rechecks completeness and must equal that refund's fully reconciled amount; its batch claims must use the exact linked items. Same-order voluntary refunds without this prior provenance are rejected.

#### Admission-ticket rules

- `ISSUED`: eligible under the approved refund policy. The local request atomically transitions it to terminal admission state `VOIDED` and records revocation before the provider call. Refund financial progress is tracked separately on `PrimaryRefund` and its attempts.
- `VOIDED`: voiding is not proof of cash refund. The ticket may be selected only if its captured allocation has not already been refunded and the void reason is compatible with the approved policy. Existing void/revocation evidence is preserved and the refund creates separate financial evidence.
- `CHECKED_IN`: ordinary buyer and organizer refunds fail closed. The accepted scan is immutable and admission is never undone. Whether any post-entry cash refund is allowed, who may approve it, and whether organizer or platform bears it is a mandatory policy decision. Until approved, the design creates `POLICY_REVIEW_REQUIRED`/obligation evidence only and makes no provider request.
- A ticket referenced by `REQUESTED`, `PROVIDER_PENDING`, `SUCCEEDED`, or `RECONCILIATION_REQUIRED` refund evidence cannot be selected by another ordinary request. Exact command replay returns the original refund record; changed selection/amount/scope conflicts. A terminally `FAILED` parent leaves admission `VOIDED` and requires a separate reviewed financial/support resolution; it cannot be retried or made usable.
- No refund transition restores `ISSUED`, deletes an accepted scan, or makes a revoked credential usable. Transfer/reissue interactions remain a separate design gate.

#### Event cancellation and inventory policy

- Cancellation activation is one small serialized event-level transaction with a non-empty reason and a new immutable cancellation generation. It snapshots the covered paid orders/tickets (or a stable high-water mark plus exact eligibility predicate), closes future sales/holds, prevents new payment attempts, makes event admission fail closed for all tickets in that generation, and emits activation audit/outbox evidence. It does not scan every ticket, create every obligation, or claim provider cash was refunded in this transaction.
- Bounded workers then claim stable ordered batches for that generation. Each idempotent batch terminally voids eligible unscanned tickets, records exact revocations, materializes obligations/refund items from immutable allocations, and writes protected audit/outbox evidence in one transaction. Batch keys bind cancellation generation plus range/item set; exact replay is a no-op and changed reuse conflicts.
- Existing `CHECKED_IN` tickets and accepted scans remain immutable. They receive separately classified post-entry liability/policy-review evidence; no automatic refund is requested until the checked-in policy and cost bearer are approved.
- Admission checks and issuance/reissue boundaries must consult the active cancellation generation, so affected credentials fail closed from activation through batch completion even before their per-ticket revocation row is materialized.
- The generation stores expected covered counts and allocation totals. `REFUNDING` requires activation plus continued freeze; `RESOLVED` requires database-proven complete batch coverage with no gaps/duplicates, exact count/amount reconciliation to the immutable snapshot, and every obligation satisfied or explicitly waived under approved authority. Pending, failed, ambiguous, chargeback, and negative-balance amounts remain visible and prevent false completion.
- `HELD` inventory may be released when cancellation activation makes sale impossible. `PAYMENT_COMMITTED` inventory follows the payment reconciliation rules and is never released merely because cancellation was requested. Paid/refunded ticket inventory does not automatically return to availability.
- Returning refunded inventory requires all of: provider-confirmed refund, ticket revocation, event not cancelled, sales window open, ticket type active, policy permitting resale, and a serialized capacity transaction. Default before that policy is approved is **no return to availability**.
- Postponement, rescheduling, replacement events, and event abandonment are not aliases for cancellation and require later policy/design.

#### Chargebacks, late outcomes, and reconciliation

- A chargeback/dispute is separate provider evidence and liability, not a refund. It does not reuse refund IDs or silently mark tickets refunded. Admission invalidation timing, representment, fee allocation, and cost bearer require approved policy.
- Refund reconciliation compares local request/attempt/item/allocation state to Stripe by immutable provider IDs and expected totals. Safe missing terminal events may be applied idempotently; mismatches, unreachable provider state, partial provider evidence, or contradictory outcomes enter `RECONCILIATION_REQUIRED` without restoring admission.
- Late payment success that cannot be fulfilled keeps its existing refund obligation. Creating the refund must bind to that exact exception and cannot issue admission. Late refund success satisfies the obligation exactly once.
- Operational queues must expose open cancellation liabilities, refund-pending credentials, provider-pending age, failures, ambiguity, chargebacks, checked-in policy reviews, and negative organizer balances. No automatic write-off or reserve draw is inferred.

#### Authorization and reasons

- Buyer self-service may request only the buyer's own eligible tickets under the approved policy. It cannot select checked-in tickets, override amounts, choose currency, or name organizer/provider scope.
- Organizer `FINANCE` or `OWNER` may request/refile refunds within the same organizer; event cancellation requires `OWNER` plus a separately approved cancellation authority. `BOX_OFFICE` may record a support recommendation but cannot cause cash movement. `EVENT_MANAGER` cannot refund unless separately granted a future explicit permission.
- Platform `ADMIN` has no implicit organizer-role bypass. A future emergency/support operation must use a distinct platform-authority path, exact tenant scope, non-empty reason, and immutable audit evidence.
- Current user role, verification, ban state, membership, organizer suspension, and tenant scope are reloaded inside the transaction. Suspension blocks sales but must not block authorized refunds/cancellation resolution for existing buyers.
- Staff cancellation, refund, retry, waiver, reconciliation resolution, post-entry exception, and inventory-return commands require trimmed non-empty reasons and request IDs bound to all material inputs.

#### Audit, privacy, retention, and database controls

- Audit/outbox writes share the state-changing transaction. Payloads contain IDs, typed states, integer amounts/currency, allocation digest, actor type, and reason reference only—never card data, client secrets, raw webhook bodies, bearer credentials, buyer contact data, or arbitrary provider payloads.
- Provider payloads are reduced after signature verification to an allowlisted material digest and identifiers. Idempotency digests are one-way and bind all material command inputs.
- Refund financial/evidence rows and admission revocations are append-only; corrections use new attempts, reversal/adjustment evidence, or explicit superseding decisions. Database guards reject cross-tenant children, excess cumulative allocations, invalid transitions, evidence deletion/rewrite, and refund success without matching provider confirmation.
- Retention must preserve financial, tax, dispute, refund, cancellation, credential-revocation, scan, and audit evidence for approved legal periods while minimizing device/buyer data. Legal hold supersedes ordinary deletion. Exact Canadian retention periods and data-controller responsibilities remain unresolved.

#### Mandatory decisions before implementation

1. Merchant of record and contractual party responsible for consumer refunds.
2. Refundability and cost bearer for face value, mandatory fees, taxes, processor fees, goodwill, chargebacks, and rounding differences.
3. Checked-in refund rule, approval authority, fraud controls, and organizer/platform liability.
4. Cancellation/postponement policy, refund deadlines, attendee choice, organizer indemnity/insurance, and abandoned-event treatment.
5. Reserve percentage/hold period, reserve draw order, negative-balance collection, payout offset, insolvency exposure, and platform loss limits.
6. Whether/when provider-confirmed refunded inventory may be resold, including tax/invoice and capacity consequences.
7. Supported Stripe refund semantics, retry limits, reconciliation service levels, manual exception ownership, and chargeback workflow.
8. Required notices/consents, jurisdiction, tax-credit documents, accounting recognition, privacy retention, and audit access.

#### Proposed PostgreSQL verification matrix

- Clean migration and positive full-order/ticket-level creation with exact component sums, quotient/remainder boundaries, maximum integer values, and refund-all-tickets reconciliation.
- Concurrent overlapping partial/full requests: only one claim per ticket/allocation; exact replay returns one record; changed item/amount/scope/reason/provider-attempt reuse conflicts with no residue.
- Direct cross-organizer/event/order/payment/ticket/credential/buyer/currency inserts and cumulative over-refunds fail by composite constraints/guards.
- `ISSUED`, `VOIDED`, `CHECKED_IN`, already-pending, refunded, payment-exception, late-success, and mismatched-provider eligibility cases; checked-in requests make no provider call.
- Injected audit/outbox/revocation/allocation failure rolls back local refund reservation, ticket state, credentials, obligations, and all evidence together; provider adapter is not called.
- Provider success/failure/ambiguity, duplicate/reordered/changed-payload events, attachment races, late success after failure, contradictory late failure, wrong amount/currency/payment/order metadata, and reconciliation repair.
- Simultaneous next-attempt authorizations after authenticated `TERMINAL_FAILED` evidence create at most one next ordinal/provider identity and one audit/outbox pair; exact authorization replay returns it, while changed input conflicts without residue.
- Parent refunds in `SUCCEEDED`, explicitly abandoned `FAILED`, or `CANCELLED_BEFORE_PROVIDER` reject every retry/attempt-creation command. Contradictory late evidence remains append-only and cannot change terminal success or authorize another attempt.
- Event-cancellation concurrency creates one generation/activation; activation immediately freezes sale and admission, bounded batches create every revocation/obligation exactly once, batch replay/conflict is safe, coverage counts/amounts reconcile, checked-in history survives, and `RESOLVED` is rejected for gaps or open obligations. No cash reversal exists before provider confirmation.
- Inventory tests prove holds close on cancellation, committed payment is not blindly released, refunded inventory defaults unavailable, and any future approved return is serialized against capacity.
- Direct UPDATE/DELETE/invalid-transition tests for refund, attempt, item, allocation, obligation, revocation, provider-event, ticket, and audit evidence.
- Authorization tests cover buyer ownership, organizer roles, stale roles, unverified/banned actors, revoked membership, tenant/event mismatch, suspension behavior, required reasons, and platform-admin no-bypass.

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
3. **Commit locally, then create provider attempt:** one serializable transaction validates/reserves the scoped attempt command/key, changes the reservation to `PAYMENT_COMMITTED` and order to `PAYMENT_PROCESSING`, creates the local attempt, and writes protected audit/outbox evidence. Any failure rolls back the complete local unit. Only after that transaction commits may the adapter create or retrieve an unconfirmed Stripe test PaymentIntent with the platform-owned provider idempotency key. Cross-order or cross-scope key reuse therefore fails without order/inventory mutation. If provider creation or attachment is ambiguous, reconciliation uses that same key; local committed inventory is retained. Until a separately reviewed checkout milestone, no client secret is returned. Verified webhooks racing one-time provider attachment correlate only through complete server-owned scope and expected value; changed provider-event ID reuse fails closed, and payment evidence is database-protected.
4. **Client payment:** the browser confirms the PaymentIntent. Browser success or failure is advisory; it never fulfils an order or releases inventory.
5. **Webhook:** the dedicated endpoint verifies its dedicated signature, claims the provider event, and processes it once. Success validates order, amount, currency, intent, and committed capacity, then atomically consumes inventory, records capture ledger entries, and issues credentials. An idempotent outbox sends receipts after commit.
6. **Terminal failure/cancellation:** a verified Stripe terminal state returns committed inventory to sale and marks the order failed or cancelled. A retryable state remains committed.
7. **Abandonment/timeout:** a HELD reservation expires normally. A PAYMENT_COMMITTED reservation is never time-expired blindly. After its resolution deadline, a worker retrieves Stripe state and releases only a proven terminal failure/cancellation, fulfils a proven success, or moves ambiguity to EXCEPTION while retaining capacity and alerting operations.
8. **Late success:** a delayed success consumes the inventory that remained committed. If corrupted state or an invariant breach makes fulfilment impossible, the system issues no credential and creates an operational exception plus an idempotent automatic full-refund obligation.
9. **Refund:** the request names exact tickets. One serializable local transaction creates or reuses the refund command, materializes immutable allocations, terminally voids eligible unscanned admission tickets, and writes revocation/audit/outbox evidence. Only after local commit may the adapter call Stripe using the bound provider idempotency identity. Signed success or authenticated reconciliation confirms cash reversal; failure or ambiguity never resurrects a credential, and uncertain attempts cannot be retried under a new identity.
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
