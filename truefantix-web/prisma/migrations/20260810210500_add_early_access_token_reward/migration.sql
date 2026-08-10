ALTER TABLE "EarlyAccessLead"
  ADD COLUMN "accessTokenReward" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "accessTokenRewardedAt" TIMESTAMP(3),
  ADD COLUMN "accessTokenRewardUserId" TEXT;

CREATE INDEX "EarlyAccessLead_accessTokenRewardedAt_idx"
  ON "EarlyAccessLead"("accessTokenRewardedAt");
