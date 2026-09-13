CREATE TABLE "TransferProofDeliveryIntent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferProofDeliveryIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransferProofDeliveryIntent_idempotencyKey_key"
ON "TransferProofDeliveryIntent"("idempotencyKey");

CREATE INDEX "TransferProofDeliveryIntent_status_availableAt_idx"
ON "TransferProofDeliveryIntent"("status", "availableAt");

CREATE INDEX "TransferProofDeliveryIntent_status_leaseExpiresAt_idx"
ON "TransferProofDeliveryIntent"("status", "leaseExpiresAt");

CREATE INDEX "TransferProofDeliveryIntent_orderId_createdAt_idx"
ON "TransferProofDeliveryIntent"("orderId", "createdAt");
