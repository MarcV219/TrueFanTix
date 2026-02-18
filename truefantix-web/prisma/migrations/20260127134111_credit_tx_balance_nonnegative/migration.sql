-- Enforce non-negative running balance for credits
-- SQLite requires table rebuild to add CHECK constraints

PRAGMA foreign_keys=off;

CREATE TABLE "_CreditTransaction_new" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sellerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "amountCredits" INTEGER NOT NULL,
  "balanceAfterCredits" INTEGER,
  "note" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "ticketId" TEXT,
  "orderId" TEXT,
  "payoutId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "balance_non_negative"
    CHECK ("balanceAfterCredits" IS NULL OR "balanceAfterCredits" >= 0),

  CONSTRAINT "CreditTransaction_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "_CreditTransaction_new"
SELECT * FROM "CreditTransaction";

DROP TABLE "CreditTransaction";

ALTER TABLE "_CreditTransaction_new"
RENAME TO "CreditTransaction";

PRAGMA foreign_keys=on;
