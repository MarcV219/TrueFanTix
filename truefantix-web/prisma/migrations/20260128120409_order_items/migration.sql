/*
  Warnings:

  - You are about to drop the column `ticketId` on the `Order` table. All the data in the column will be lost.

*/

-- IMPORTANT: drop trigger first so SQLite doesn't error during table redefinition
DROP TRIGGER IF EXISTS "event_sellout_immutable_after_order";

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "faceValueCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "buyerSellerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "amountCents" INTEGER NOT NULL,
    "adminFeeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_buyerSellerId_fkey" FOREIGN KEY ("buyerSellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Order" (
  "adminFeeCents",
  "amountCents",
  "buyerSellerId",
  "createdAt",
  "id",
  "idempotencyKey",
  "sellerId",
  "status",
  "totalCents"
)
SELECT
  "adminFeeCents",
  "amountCents",
  "buyerSellerId",
  "createdAt",
  "id",
  "idempotencyKey",
  "sellerId",
  "status",
  "totalCents"
FROM "Order";

DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";

CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt");
CREATE INDEX "Order_buyerSellerId_createdAt_idx" ON "Order"("buyerSellerId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_ticketId_key" ON "OrderItem"("ticketId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_createdAt_idx" ON "OrderItem"("orderId", "createdAt");

-- Recreate trigger (updated for OrderItem-based orders)
CREATE TRIGGER IF NOT EXISTS "event_sellout_immutable_after_order"
BEFORE UPDATE OF "selloutStatus" ON "Event"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM "Ticket" t
  JOIN "OrderItem" oi ON oi."ticketId" = t."id"
  JOIN "Order" o ON o."id" = oi."orderId"
  WHERE t."eventId" = OLD."id"
)
AND NEW."selloutStatus" <> OLD."selloutStatus"
BEGIN
  SELECT RAISE(ABORT, 'selloutStatus cannot be changed after an order exists for this event');
END;
