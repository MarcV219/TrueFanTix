-- Provider-free order and immutable price-snapshot foundation.

CREATE TYPE "PrimaryOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_PROCESSING');
CREATE TYPE "PrimaryPriceComponentKind" AS ENUM ('FACE_VALUE', 'MANDATORY_FEE', 'TAX');

CREATE TABLE "PrimaryOrder" (
  "id" TEXT NOT NULL, "organizerId" TEXT NOT NULL, "eventId" TEXT NOT NULL, "buyerUserId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL, "status" "PrimaryOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "currency" TEXT NOT NULL, "faceValueSubtotalMinor" INTEGER NOT NULL, "grossTotalMinor" INTEGER NOT NULL,
  "createIdempotencyKey" TEXT NOT NULL, "prepareIdempotencyKey" TEXT, "paymentProcessingAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryOrder_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PrimaryOrder_amounts_check" CHECK ("faceValueSubtotalMinor" > 0 AND "grossTotalMinor" >= "faceValueSubtotalMinor"),
  CONSTRAINT "PrimaryOrder_state_check" CHECK (("status" = 'PENDING_PAYMENT' AND "paymentProcessingAt" IS NULL) OR ("status" = 'PAYMENT_PROCESSING' AND "paymentProcessingAt" IS NOT NULL))
);

CREATE TABLE "PrimaryOrderLine" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "ticketTypeId" TEXT NOT NULL, "quantity" INTEGER NOT NULL,
  "ticketTypeNameSnapshot" TEXT NOT NULL, "unitFaceValueMinor" INTEGER NOT NULL, "faceValueSubtotalMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryOrderLine_amounts_check" CHECK ("quantity" > 0 AND "unitFaceValueMinor" > 0 AND "faceValueSubtotalMinor" = "quantity" * "unitFaceValueMinor"),
  CONSTRAINT "PrimaryOrderLine_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "PrimaryOrderPriceComponent" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "orderLineId" TEXT NOT NULL, "code" TEXT NOT NULL, "label" TEXT NOT NULL,
  "kind" "PrimaryPriceComponentKind" NOT NULL, "amountMinor" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  "allocationBaseMinor" INTEGER NOT NULL, "allocationRemainderUnits" INTEGER NOT NULL, "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryOrderPriceComponent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryOrderPriceComponent_amount_check" CHECK ("amountMinor" > 0 AND "allocationBaseMinor" >= 0 AND "allocationRemainderUnits" >= 0),
  CONSTRAINT "PrimaryOrderPriceComponent_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PrimaryOrderPriceComponent_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "PrimaryOrder_reservationId_key" ON "PrimaryOrder"("reservationId");
CREATE UNIQUE INDEX "PrimaryOrder_createIdempotencyKey_key" ON "PrimaryOrder"("createIdempotencyKey");
CREATE UNIQUE INDEX "PrimaryOrder_prepareIdempotencyKey_key" ON "PrimaryOrder"("prepareIdempotencyKey");
CREATE INDEX "PrimaryOrder_organizerId_eventId_status_createdAt_idx" ON "PrimaryOrder"("organizerId", "eventId", "status", "createdAt");
CREATE INDEX "PrimaryOrder_buyerUserId_createdAt_idx" ON "PrimaryOrder"("buyerUserId", "createdAt");
CREATE UNIQUE INDEX "PrimaryOrderLine_orderId_key" ON "PrimaryOrderLine"("orderId");
CREATE UNIQUE INDEX "PrimaryOrderPriceComponent_orderId_code_key" ON "PrimaryOrderPriceComponent"("orderId", "code");
CREATE UNIQUE INDEX "PrimaryOrderPriceComponent_orderId_position_key" ON "PrimaryOrderPriceComponent"("orderId", "position");
CREATE INDEX "PrimaryOrderPriceComponent_orderLineId_idx" ON "PrimaryOrderPriceComponent"("orderLineId");

ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PrimaryInventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrderLine" ADD CONSTRAINT "PrimaryOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PrimaryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrderLine" ADD CONSTRAINT "PrimaryOrderLine_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "PrimaryTicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrderPriceComponent" ADD CONSTRAINT "PrimaryOrderPriceComponent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PrimaryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrderPriceComponent" ADD CONSTRAINT "PrimaryOrderPriceComponent_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PrimaryOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
