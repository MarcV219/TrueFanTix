# Ticket Transfer In/Out of Escrow — Investigation & Plan

## Objective
Define how tickets should move into custody (escrow) and out of custody safely, while preserving current order/payment flows.

## Current system (already implemented)
- **Money escrow** exists logically:
  - `Order.PAID` => funds held
  - `Order.DELIVERED` => release-ready
  - `Order.COMPLETED` => released (payout queued)
- Ticket lifecycle exists:
  - `AVAILABLE -> RESERVED -> SOLD`
- There is **no dedicated ticket-custody model** yet (no explicit "ticket escrow" table/state).

## Gap
We can hold money, but ticket custody is implicit. For strong operational control, we need explicit custody state for each ticket transfer.

## Recommended design (Phase 2)
Add a dedicated model for ticket escrow custody.

### Prisma model proposal
```prisma
enum TicketEscrowState {
  NONE
  DEPOSIT_PENDING
  IN_ESCROW
  RELEASED_TO_BUYER
  RELEASED_BACK_TO_SELLER
  FAILED
}

model TicketEscrow {
  id            String   @id @default(cuid())
  ticketId       String   @unique
  ticket         Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  orderId        String?
  order          Order?   @relation(fields: [orderId], references: [id], onDelete: SetNull)

  state          TicketEscrowState @default(NONE)
  provider       String?           // e.g. TM_TRANSFER, AXS_TRANSFER, MANUAL
  providerRef    String?

  depositedAt    DateTime?
  releasedAt     DateTime?
  releasedTo     String?           // BUYER|SELLER
  failureReason  String?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([state, updatedAt])
  @@index([orderId])
}
```

## API contract proposal

### 1) Deposit ticket into escrow
`POST /api/tickets/:id/escrow/deposit`
- Auth: seller owner (or admin)
- Preconditions:
  - ticket is `AVAILABLE`
  - verification status not `REJECTED`
  - no active conflicting order
- Effects:
  - create/update `TicketEscrow` => `IN_ESCROW`
  - optionally set ticket non-public/listing-locked flag (or keep available with escrow-required metadata)

### 2) Release to buyer
`POST /api/orders/:id/escrow/release-ticket`
- Auth: admin/system automation
- Preconditions:
  - payment succeeded (`Order.PAID`)
  - order deliver conditions met
  - escrow state is `IN_ESCROW`
- Effects:
  - `TicketEscrow.state = RELEASED_TO_BUYER`
  - order progresses to `DELIVERED`

### 3) Release back to seller (cancel/refund/failure)
`POST /api/orders/:id/escrow/release-back`
- Auth: admin/system automation
- Preconditions:
  - order cancelled/refunded/failed
- Effects:
  - `TicketEscrow.state = RELEASED_BACK_TO_SELLER`
  - ticket returns to `AVAILABLE` (or seller-chosen state)

### 4) Read escrow custody
`GET /api/tickets/:id/escrow`
- returns custody state, timestamps, provider refs, failure reason

## State machine (ticket + money)
1. `AVAILABLE` + `NOT_FUNDED` + `NONE`
2. Buyer checkout => `RESERVED`
3. Payment success => money `FUNDS_HELD`
4. Ticket deposited/confirmed => custody `IN_ESCROW`
5. Delivery complete => custody `RELEASED_TO_BUYER`, order `DELIVERED`
6. Completion => money `RELEASED`, payout queued

Failure path:
- If payment fails/refund/cancel before delivery:
  - custody => `RELEASED_BACK_TO_SELLER`
  - money => `REFUNDED` or `FAILED`

## Why this design
- Explicit auditability for disputes/chargebacks
- Idempotent operations per ticket/order
- Clean separation: money escrow vs ticket custody escrow
- Extensible to provider-based transfer APIs later

## Immediate next implementation steps
1. Add `TicketEscrowState` enum + `TicketEscrow` model + migration
2. Add 4 API routes above
3. Add integration tests for success + failure paths
4. Add dashboard block for custody escrow metrics
