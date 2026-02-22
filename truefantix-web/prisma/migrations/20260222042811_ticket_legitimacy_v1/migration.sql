-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
DROP TRIGGER IF EXISTS "event_sellout_immutable_after_order";
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "faceValueCents" INTEGER,
    "image" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "row" TEXT,
    "seat" TEXT,
    "eventId" TEXT,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "reservedUntil" DATETIME,
    "reservedByOrderId" TEXT,
    "soldAt" DATETIME,
    "withdrawnAt" DATETIME,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "verificationScore" INTEGER,
    "verificationReason" TEXT,
    "verificationProvider" TEXT,
    "verificationEvidence" TEXT,
    "verifiedAt" DATETIME,
    "barcodeHash" TEXT,
    "barcodeType" TEXT,
    "barcodeLast4" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sellerId" TEXT NOT NULL,
    CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Ticket" ("createdAt", "date", "eventId", "faceValueCents", "id", "image", "lastViewedAt", "priceCents", "reservedByOrderId", "reservedUntil", "row", "seat", "sellerId", "soldAt", "status", "title", "updatedAt", "venue", "viewCount", "withdrawnAt") SELECT "createdAt", "date", "eventId", "faceValueCents", "id", "image", "lastViewedAt", "priceCents", "reservedByOrderId", "reservedUntil", "row", "seat", "sellerId", "soldAt", "status", "title", "updatedAt", "venue", "viewCount", "withdrawnAt" FROM "Ticket";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE INDEX "Ticket_sellerId_status_createdAt_idx" ON "Ticket"("sellerId", "status", "createdAt");
CREATE INDEX "Ticket_eventId_idx" ON "Ticket"("eventId");
CREATE INDEX "Ticket_barcodeHash_idx" ON "Ticket"("barcodeHash");
CREATE TRIGGER "event_sellout_immutable_after_order"
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
