ALTER TYPE "AccessTokenTxSource" ADD VALUE IF NOT EXISTS 'PROMOTION';

CREATE TABLE "PromotionParticipation" (
    "id" TEXT NOT NULL,
    "promotionKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "orderId" TEXT,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "tokensAwarded" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionParticipation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromotionParticipation_promotionKey_kind_referenceId_key" ON "PromotionParticipation"("promotionKey", "kind", "referenceId");
CREATE INDEX "PromotionParticipation_promotionKey_kind_occurredAt_idx" ON "PromotionParticipation"("promotionKey", "kind", "occurredAt");
CREATE INDEX "PromotionParticipation_userId_occurredAt_idx" ON "PromotionParticipation"("userId", "occurredAt");
CREATE INDEX "PromotionParticipation_sellerId_occurredAt_idx" ON "PromotionParticipation"("sellerId", "occurredAt");
ALTER TABLE "PromotionParticipation" ADD CONSTRAINT "PromotionParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
