-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CreditTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCredits" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'UNKNOWN',
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
INSERT INTO "new_CreditTransaction" ("amountCredits", "balanceAfterCredits", "createdAt", "id", "note", "orderId", "payoutId", "referenceId", "referenceType", "sellerId", "source", "ticketId", "type") SELECT "amountCredits", "balanceAfterCredits", "createdAt", "id", "note", "orderId", "payoutId", "referenceId", "referenceType", "sellerId", coalesce("source", 'UNKNOWN') AS "source", "ticketId", "type" FROM "CreditTransaction";
DROP TABLE "CreditTransaction";
ALTER TABLE "new_CreditTransaction" RENAME TO "CreditTransaction";
CREATE INDEX "CreditTransaction_sellerId_createdAt_idx" ON "CreditTransaction"("sellerId", "createdAt");
CREATE INDEX "CreditTransaction_type_createdAt_idx" ON "CreditTransaction"("type", "createdAt");
CREATE INDEX "CreditTransaction_source_createdAt_idx" ON "CreditTransaction"("source", "createdAt");
CREATE INDEX "CreditTransaction_orderId_idx" ON "CreditTransaction"("orderId");
CREATE INDEX "CreditTransaction_payoutId_idx" ON "CreditTransaction"("payoutId");
CREATE INDEX "CreditTransaction_ticketId_idx" ON "CreditTransaction"("ticketId");
CREATE UNIQUE INDEX "CreditTransaction_orderId_ticketId_sellerId_type_source_key" ON "CreditTransaction"("orderId", "ticketId", "sellerId", "type", "source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
