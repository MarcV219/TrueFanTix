DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CreditTxType') THEN
    ALTER TYPE "CreditTxType" RENAME TO "AccessTokenTxType";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CreditTxSource') THEN
    ALTER TYPE "CreditTxSource" RENAME TO "AccessTokenTxSource";
  END IF;
END $$;

ALTER TABLE IF EXISTS "Seller"
  RENAME COLUMN "creditBalanceCredits" TO "accessTokenBalance";

ALTER TABLE IF EXISTS "Referral"
  RENAME COLUMN "creditsAwarded" TO "accessTokensAwarded";

ALTER TABLE IF EXISTS "CreditTransaction"
  RENAME TO "AccessTokenTransaction";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME COLUMN "amountCredits" TO "amountAccessTokens";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME COLUMN "balanceAfterCredits" TO "balanceAfterAccessTokens";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME CONSTRAINT "CreditTransaction_pkey" TO "AccessTokenTransaction_pkey";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME CONSTRAINT "CreditTransaction_sellerId_fkey" TO "AccessTokenTransaction_sellerId_fkey";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME CONSTRAINT "CreditTransaction_ticketId_fkey" TO "AccessTokenTransaction_ticketId_fkey";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME CONSTRAINT "CreditTransaction_orderId_fkey" TO "AccessTokenTransaction_orderId_fkey";

ALTER TABLE IF EXISTS "AccessTokenTransaction"
  RENAME CONSTRAINT "CreditTransaction_payoutId_fkey" TO "AccessTokenTransaction_payoutId_fkey";

ALTER INDEX IF EXISTS "CreditTransaction_sellerId_createdAt_idx"
  RENAME TO "AccessTokenTransaction_sellerId_createdAt_idx";

ALTER INDEX IF EXISTS "CreditTransaction_type_createdAt_idx"
  RENAME TO "AccessTokenTransaction_type_createdAt_idx";

ALTER INDEX IF EXISTS "CreditTransaction_source_createdAt_idx"
  RENAME TO "AccessTokenTransaction_source_createdAt_idx";

ALTER INDEX IF EXISTS "CreditTransaction_orderId_idx"
  RENAME TO "AccessTokenTransaction_orderId_idx";

ALTER INDEX IF EXISTS "CreditTransaction_payoutId_idx"
  RENAME TO "AccessTokenTransaction_payoutId_idx";

ALTER INDEX IF EXISTS "CreditTransaction_ticketId_idx"
  RENAME TO "AccessTokenTransaction_ticketId_idx";

ALTER INDEX IF EXISTS "CreditTransaction_orderId_ticketId_sellerId_type_source_key"
  RENAME TO "AccessTokenTransaction_orderId_ticketId_sellerId_type_source_key";
