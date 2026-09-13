-- Fence late workers with a per-lease token, and distinguish a worker that
-- died before the provider boundary from one whose send outcome is ambiguous.
ALTER TABLE "TransferProofDeliveryIntent"
ADD COLUMN "claimToken" TEXT,
ADD COLUMN "dispatchStartedAt" TIMESTAMP(3);

-- Every legacy PROCESSING row may already have crossed the provider boundary.
-- Backfill conservative evidence so deployment cannot reinterpret an old
-- ambiguous claim as a proven pre-dispatch crash.
UPDATE "TransferProofDeliveryIntent"
SET
  "claimToken" = 'legacy-' || "id",
  "dispatchStartedAt" = COALESCE("processingAt", "updatedAt", "createdAt")
WHERE "status" = 'PROCESSING';
