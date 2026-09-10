-- Isolated non-public GA reservation foundation. No orders or payment-provider data.

CREATE TYPE "PrimaryInventoryReservationStatus" AS ENUM ('HELD', 'PAYMENT_COMMITTED', 'RELEASED', 'EXPIRED');

CREATE TABLE "PrimaryInventoryReservation" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "ticketTypeId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "PrimaryInventoryReservationStatus" NOT NULL DEFAULT 'HELD',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "paymentCommittedAt" TIMESTAMP(3),
  "reconciliationAfter" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createIdempotencyKey" TEXT NOT NULL,
  "commitIdempotencyKey" TEXT,
  "releaseIdempotencyKey" TEXT,
  "expireIdempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryInventoryReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryInventoryReservation_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "PrimaryInventoryReservation_state_metadata_check" CHECK (
    ("status" = 'HELD' AND "paymentCommittedAt" IS NULL AND "reconciliationAfter" IS NULL AND "releasedAt" IS NULL AND "expiredAt" IS NULL)
    OR ("status" = 'PAYMENT_COMMITTED' AND "paymentCommittedAt" IS NOT NULL AND "reconciliationAfter" IS NOT NULL AND "releasedAt" IS NULL AND "expiredAt" IS NULL)
    OR ("status" = 'RELEASED' AND "paymentCommittedAt" IS NULL AND "reconciliationAfter" IS NULL AND "releasedAt" IS NOT NULL AND "expiredAt" IS NULL)
    OR ("status" = 'EXPIRED' AND "paymentCommittedAt" IS NULL AND "reconciliationAfter" IS NULL AND "releasedAt" IS NULL AND "expiredAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "PrimaryInventoryReservation_createIdempotencyKey_key" ON "PrimaryInventoryReservation"("createIdempotencyKey");
CREATE UNIQUE INDEX "PrimaryInventoryReservation_commitIdempotencyKey_key" ON "PrimaryInventoryReservation"("commitIdempotencyKey");
CREATE UNIQUE INDEX "PrimaryInventoryReservation_releaseIdempotencyKey_key" ON "PrimaryInventoryReservation"("releaseIdempotencyKey");
CREATE UNIQUE INDEX "PrimaryInventoryReservation_expireIdempotencyKey_key" ON "PrimaryInventoryReservation"("expireIdempotencyKey");
CREATE INDEX "PrimaryInventoryReservation_organizerId_eventId_status_expiresAt_idx" ON "PrimaryInventoryReservation"("organizerId", "eventId", "status", "expiresAt");
CREATE INDEX "PrimaryInventoryReservation_ticketTypeId_status_expiresAt_idx" ON "PrimaryInventoryReservation"("ticketTypeId", "status", "expiresAt");
CREATE INDEX "PrimaryInventoryReservation_buyerUserId_createdAt_idx" ON "PrimaryInventoryReservation"("buyerUserId", "createdAt");

ALTER TABLE "PrimaryInventoryReservation" ADD CONSTRAINT "PrimaryInventoryReservation_eventId_organizerId_fkey"
  FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryInventoryReservation" ADD CONSTRAINT "PrimaryInventoryReservation_ticketTypeId_organizerId_eventId_fkey"
  FOREIGN KEY ("ticketTypeId", "organizerId", "eventId") REFERENCES "PrimaryTicketType"("id", "organizerId", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryInventoryReservation" ADD CONSTRAINT "PrimaryInventoryReservation_buyerUserId_fkey"
  FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
