/*
  Warnings:

  - You are about to drop the column `amountCents` on the `CreditTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `balanceAfterCents` on the `CreditTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `creditBalanceCents` on the `Seller` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "venue" TEXT,
    "date" TEXT,
    "selloutStatus" TEXT NOT NULL DEFAULT 'NOT_SOLD_OUT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CreditTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCredits" INTEGER NOT NULL DEFAULT 0,
    "balanceAfterCredits" INTEGER,
    "note" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "ticketId" TEXT,
    "orderId" TEXT,
    "payoutId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CreditTransaction" ("createdAt", "id", "note", "orderId", "payoutId", "referenceId", "referenceType", "sellerId", "ticketId", "type") SELECT "createdAt", "id", "note", "orderId", "payoutId", "referenceId", "referenceType", "sellerId", "ticketId", "type" FROM "CreditTransaction";
DROP TABLE "CreditTransaction";
ALTER TABLE "new_CreditTransaction" RENAME TO "CreditTransaction";
CREATE INDEX "CreditTransaction_sellerId_createdAt_idx" ON "CreditTransaction"("sellerId", "createdAt");
CREATE INDEX "CreditTransaction_type_createdAt_idx" ON "CreditTransaction"("type", "createdAt");
CREATE INDEX "CreditTransaction_orderId_idx" ON "CreditTransaction"("orderId");
CREATE INDEX "CreditTransaction_payoutId_idx" ON "CreditTransaction"("payoutId");
CREATE TABLE "new_Seller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rating" REAL NOT NULL DEFAULT 0,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "creditBalanceCredits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Seller" ("createdAt", "id", "name", "rating", "reviews", "updatedAt") SELECT "createdAt", "id", "name", "rating", "reviews", "updatedAt" FROM "Seller";
DROP TABLE "Seller";
ALTER TABLE "new_Seller" RENAME TO "Seller";
CREATE INDEX "Seller_createdAt_idx" ON "Seller"("createdAt");
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "faceValueCents" INTEGER,
    "image" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "eventId" TEXT,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sellerId" TEXT NOT NULL,
    CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Ticket" ("createdAt", "date", "faceValueCents", "id", "image", "lastViewedAt", "priceCents", "sellerId", "status", "title", "updatedAt", "venue", "viewCount") SELECT "createdAt", "date", "faceValueCents", "id", "image", "lastViewedAt", "priceCents", "sellerId", "status", "title", "updatedAt", "venue", "viewCount" FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE INDEX "Ticket_sellerId_status_createdAt_idx" ON "Ticket"("sellerId", "status", "createdAt");
CREATE INDEX "Ticket_eventId_idx" ON "Ticket"("eventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Event_selloutStatus_idx" ON "Event"("selloutStatus");
