/*
  Warnings:

  - You are about to drop the `Order` table. If the table is not empty, all the data it contains will be lost.

*/

-- IMPORTANT: Drop trigger first so SQLite doesn't choke while Prisma drops/redefines tables
DROP TRIGGER IF EXISTS "event_sellout_immutable_after_order";

-- DropIndex
DROP INDEX "Order_status_createdAt_idx";

-- DropIndex
DROP INDEX "Order_buyerSellerId_createdAt_idx";

-- DropIndex
DROP INDEX "Order_sellerId_createdAt_idx";

-- DropIndex
DROP INDEX "Order_idempotencyKey_key";

-- DropIndex
DROP INDEX "Order_ticketId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Order";
PRAGMA foreign_keys=on;

-- CreateTable (NOTE: singular "Order" is correct for Prisma model Order)
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerSellerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "amountCents" INTEGER NOT NULL,
    "adminFeeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_buyerSellerId_fkey" FOREIGN KEY ("buyerSellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CreditTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCredits" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "balanceAfterCredits" INTEGER,
    "note" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "ticketId" TEXT,
    "orderId" TEXT,
    "payoutId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditTransaction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CreditTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CreditTransaction_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_CreditTransaction" (
  "amountCredits", "balanceAfterCredits", "createdAt", "id", "note", "orderId",
  "payoutId", "referenceId", "referenceType", "sellerId", "source", "ticketId", "type"
)
SELECT
  "amountCredits", "balanceAfterCredits", "createdAt", "id", "note", "orderId",
  "payoutId", "referenceId", "referenceType", "sellerId", "source", "ticketId", "type"
FROM "CreditTransaction";

DROP TABLE "CreditTransaction";
ALTER TABLE "new_CreditTransaction" RENAME TO "CreditTransaction";

CREATE INDEX "CreditTransaction_sellerId_createdAt_idx" ON "CreditTransaction"("sellerId", "createdAt");
CREATE INDEX "CreditTransaction_type_createdAt_idx" ON "CreditTransaction"("type", "createdAt");
CREATE INDEX "CreditTransaction_source_createdAt_idx" ON "CreditTransaction"("source", "createdAt");
CREATE INDEX "CreditTransaction_orderId_idx" ON "CreditTransaction"("orderId");
CREATE INDEX "CreditTransaction_payoutId_idx" ON "CreditTransaction"("payoutId");
CREATE INDEX "CreditTransaction_ticketId_idx" ON "CreditTransaction"("ticketId");

CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "status" TEXT NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Payment" (
  "amountCents", "createdAt", "currency", "id", "orderId",
  "provider", "providerRef", "status", "updatedAt"
)
SELECT
  "amountCents", "createdAt", "currency", "id", "orderId",
  "provider", "providerRef", "status", "updatedAt"
FROM "Payment";

DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";

CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Order_ticketId_key" ON "Order"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_buyerSellerId_createdAt_idx" ON "Order"("buyerSellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- Recreate trigger AFTER Prisma finishes redefining tables
CREATE TRIGGER IF NOT EXISTS "event_sellout_immutable_after_order"
BEFORE UPDATE OF "selloutStatus" ON "Event"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM "Ticket" t
  JOIN "Order" o ON o."ticketId" = t."id"
  WHERE t."eventId" = OLD."id"
)
AND NEW."selloutStatus" <> OLD."selloutStatus"
BEGIN
  SELECT RAISE(ABORT, 'selloutStatus cannot be changed after an order exists for this event');
END;
