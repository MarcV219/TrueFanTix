ALTER TABLE "Payout"
ADD COLUMN "stripeInstantPayoutId" TEXT,
ADD COLUMN "instantPayoutStatus" TEXT,
ADD COLUMN "instantPayoutAt" TIMESTAMP(3),
ADD COLUMN "instantPayoutFailure" TEXT;

CREATE UNIQUE INDEX "Payout_stripeInstantPayoutId_key" ON "Payout"("stripeInstantPayoutId");
