ALTER TABLE "Payout"
ADD COLUMN "stripeTransferId" TEXT,
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payout_stripeTransferId_key" ON "Payout"("stripeTransferId");
