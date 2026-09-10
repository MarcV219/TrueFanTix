-- Isolated draft-only general-admission capacity and ticket-type foundation.

CREATE TYPE "PrimaryTicketTypeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "PrimaryEvent" ADD COLUMN "totalCapacity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PrimaryEvent" ALTER COLUMN "totalCapacity" DROP DEFAULT;
ALTER TABLE "PrimaryEvent" ADD CONSTRAINT "PrimaryEvent_totalCapacity_check" CHECK ("totalCapacity" > 0);

CREATE TABLE "PrimaryTicketType" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "allocatedQuantity" INTEGER NOT NULL,
  "status" "PrimaryTicketTypeStatus" NOT NULL DEFAULT 'ACTIVE',
  "minimumPerOrder" INTEGER,
  "maximumPerOrder" INTEGER,
  "currency" TEXT NOT NULL,
  "basePriceMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryTicketType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryTicketType_allocatedQuantity_check" CHECK ("allocatedQuantity" > 0),
  CONSTRAINT "PrimaryTicketType_basePriceMinor_check" CHECK ("basePriceMinor" > 0),
  CONSTRAINT "PrimaryTicketType_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PrimaryTicketType_minimumPerOrder_check" CHECK ("minimumPerOrder" IS NULL OR "minimumPerOrder" > 0),
  CONSTRAINT "PrimaryTicketType_maximumPerOrder_check" CHECK ("maximumPerOrder" IS NULL OR "maximumPerOrder" > 0),
  CONSTRAINT "PrimaryTicketType_orderLimits_check" CHECK ("minimumPerOrder" IS NULL OR "maximumPerOrder" IS NULL OR "minimumPerOrder" <= "maximumPerOrder")
);

CREATE UNIQUE INDEX "PrimaryTicketType_id_organizerId_eventId_key" ON "PrimaryTicketType"("id", "organizerId", "eventId");
CREATE INDEX "PrimaryTicketType_organizerId_eventId_status_idx" ON "PrimaryTicketType"("organizerId", "eventId", "status");

ALTER TABLE "PrimaryTicketType" ADD CONSTRAINT "PrimaryTicketType_eventId_organizerId_fkey"
  FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE CASCADE ON UPDATE CASCADE;
