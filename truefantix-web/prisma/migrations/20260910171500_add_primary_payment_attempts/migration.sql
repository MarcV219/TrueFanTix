-- Isolated Stripe-test-mode payment-attempt, provider-event, and exception foundation.

ALTER TYPE "PrimaryOrderStatus" ADD VALUE 'PAID';
ALTER TYPE "PrimaryOrderStatus" ADD VALUE 'PAYMENT_FAILED';
CREATE TYPE "PrimaryPaymentAttemptStatus" AS ENUM ('PENDING_PROVIDER', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED');
CREATE TYPE "PrimaryPaymentExceptionKind" AS ENUM ('PROVIDER_MISMATCH', 'LATE_SUCCESS_REFUND_REQUIRED');

ALTER TABLE "PrimaryOrder" ADD COLUMN "paidAt" TIMESTAMP(3), ADD COLUMN "paymentFailedAt" TIMESTAMP(3);
ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_payment_scope_key" UNIQUE ("id", "organizerId", "eventId", "buyerUserId", "reservationId");
ALTER TABLE "PrimaryOrder" DROP CONSTRAINT "PrimaryOrder_state_check";
ALTER TABLE "PrimaryOrder" DROP CONSTRAINT "PrimaryOrder_prepare_command_check";
ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_prepare_command_check" CHECK (
  ("status" = 'PENDING_PAYMENT' AND "prepareIdempotencyKey" IS NULL AND "prepareReconciliationDelayMs" IS NULL) OR
  ("status" <> 'PENDING_PAYMENT' AND "prepareIdempotencyKey" IS NOT NULL AND "prepareReconciliationDelayMs" > 0)
);
ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_state_check" CHECK (
  ("status" = 'PENDING_PAYMENT' AND "paymentProcessingAt" IS NULL AND "paidAt" IS NULL AND "paymentFailedAt" IS NULL) OR
  ("status" = 'PAYMENT_PROCESSING' AND "paymentProcessingAt" IS NOT NULL AND "paidAt" IS NULL AND "paymentFailedAt" IS NULL) OR
  ("status" = 'PAID' AND "paymentProcessingAt" IS NOT NULL AND "paidAt" IS NOT NULL AND "paymentFailedAt" IS NULL) OR
  ("status" = 'PAYMENT_FAILED' AND "paymentProcessingAt" IS NOT NULL AND "paidAt" IS NULL AND "paymentFailedAt" IS NOT NULL)
);

CREATE TABLE "PrimaryPaymentAttempt" (
  "id" TEXT NOT NULL, "organizerId" TEXT NOT NULL, "eventId" TEXT NOT NULL, "buyerUserId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "status" "PrimaryPaymentAttemptStatus" NOT NULL DEFAULT 'PENDING_PROVIDER',
  "expectedAmountMinor" INTEGER NOT NULL, "currency" TEXT NOT NULL, "createIdempotencyKey" TEXT NOT NULL,
  "providerIntentId" TEXT, "providerCreatedAt" TIMESTAMP(3), "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryPaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryPaymentAttempt_amount_check" CHECK ("expectedAmountMinor" > 0 AND "expectedAmountMinor" <= 2147483647),
  CONSTRAINT "PrimaryPaymentAttempt_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PrimaryPaymentAttempt_provider_check" CHECK (("status" = 'PENDING_PROVIDER' AND "providerIntentId" IS NULL) OR "status" = 'RECONCILIATION_REQUIRED' OR ("status" NOT IN ('PENDING_PROVIDER', 'RECONCILIATION_REQUIRED') AND "providerIntentId" IS NOT NULL))
);

CREATE TABLE "PrimaryPaymentProviderEvent" (
  "id" TEXT NOT NULL, "providerEventId" TEXT NOT NULL, "attemptId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL, "eventId" TEXT NOT NULL, "buyerUserId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL, "payloadDigest" TEXT NOT NULL, "providerCreatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryPaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryPaymentException" (
  "id" TEXT NOT NULL, "attemptId" TEXT NOT NULL, "kind" "PrimaryPaymentExceptionKind" NOT NULL,
  "providerEventId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryPaymentException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrimaryPaymentAttempt_orderId_key" ON "PrimaryPaymentAttempt"("orderId");
CREATE UNIQUE INDEX "PrimaryPaymentAttempt_createIdempotencyKey_key" ON "PrimaryPaymentAttempt"("createIdempotencyKey");
CREATE UNIQUE INDEX "PrimaryPaymentAttempt_providerIntentId_key" ON "PrimaryPaymentAttempt"("providerIntentId");
CREATE UNIQUE INDEX "PrimaryPaymentAttempt_order_scope_key" ON "PrimaryPaymentAttempt"("orderId", "organizerId", "eventId", "buyerUserId", "reservationId");
CREATE UNIQUE INDEX "PrimaryPaymentAttempt_provider_event_scope_key" ON "PrimaryPaymentAttempt"("id", "orderId", "organizerId", "eventId", "buyerUserId", "reservationId");
CREATE INDEX "PrimaryPaymentAttempt_organizerId_eventId_status_idx" ON "PrimaryPaymentAttempt"("organizerId", "eventId", "status");
CREATE UNIQUE INDEX "PrimaryPaymentProviderEvent_providerEventId_key" ON "PrimaryPaymentProviderEvent"("providerEventId");
CREATE INDEX "PrimaryPaymentProviderEvent_attemptId_providerCreatedAt_idx" ON "PrimaryPaymentProviderEvent"("attemptId", "providerCreatedAt");
CREATE UNIQUE INDEX "PrimaryPaymentException_attemptId_providerEventId_kind_key" ON "PrimaryPaymentException"("attemptId", "providerEventId", "kind");

ALTER TABLE "PrimaryPaymentAttempt" ADD CONSTRAINT "PrimaryPaymentAttempt_order_scope_fkey" FOREIGN KEY ("orderId", "organizerId", "eventId", "buyerUserId", "reservationId") REFERENCES "PrimaryOrder"("id", "organizerId", "eventId", "buyerUserId", "reservationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PrimaryPaymentAttempt" ADD CONSTRAINT "PrimaryPaymentAttempt_event_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PrimaryPaymentAttempt" ADD CONSTRAINT "PrimaryPaymentAttempt_buyer_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PrimaryPaymentAttempt" ADD CONSTRAINT "PrimaryPaymentAttempt_reservation_scope_fkey" FOREIGN KEY ("reservationId", "organizerId", "eventId", "buyerUserId") REFERENCES "PrimaryInventoryReservation"("id", "organizerId", "eventId", "buyerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PrimaryPaymentProviderEvent" ADD CONSTRAINT "PrimaryPaymentProviderEvent_attempt_scope_fkey" FOREIGN KEY ("attemptId", "orderId", "organizerId", "eventId", "buyerUserId", "reservationId") REFERENCES "PrimaryPaymentAttempt"("id", "orderId", "organizerId", "eventId", "buyerUserId", "reservationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PrimaryPaymentException" ADD CONSTRAINT "PrimaryPaymentException_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PrimaryPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "reject_primary_order_snapshot_change"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'primary order financial snapshots are append-only' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizerId" IS DISTINCT FROM OLD."organizerId" OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."buyerUserId" IS DISTINCT FROM OLD."buyerUserId" OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId"
    OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."faceValueSubtotalMinor" IS DISTINCT FROM OLD."faceValueSubtotalMinor"
    OR NEW."grossTotalMinor" IS DISTINCT FROM OLD."grossTotalMinor" OR NEW."createIdempotencyKey" IS DISTINCT FROM OLD."createIdempotencyKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'primary order financial snapshot is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."status", NEW."prepareIdempotencyKey", NEW."prepareReconciliationDelayMs", NEW."paymentProcessingAt", NEW."paidAt", NEW."paymentFailedAt") IS DISTINCT FROM
     (OLD."status", OLD."prepareIdempotencyKey", OLD."prepareReconciliationDelayMs", OLD."paymentProcessingAt", OLD."paidAt", OLD."paymentFailedAt")
    AND NOT (
      (OLD."status" = 'PENDING_PAYMENT' AND NEW."status" = 'PAYMENT_PROCESSING' AND OLD."prepareIdempotencyKey" IS NULL AND NEW."prepareIdempotencyKey" IS NOT NULL AND OLD."prepareReconciliationDelayMs" IS NULL AND NEW."prepareReconciliationDelayMs" > 0 AND OLD."paymentProcessingAt" IS NULL AND NEW."paymentProcessingAt" IS NOT NULL AND NEW."paidAt" IS NULL AND NEW."paymentFailedAt" IS NULL)
      OR (OLD."status" = 'PAYMENT_PROCESSING' AND NEW."status" = 'PAID' AND NEW."paidAt" IS NOT NULL AND NEW."paymentFailedAt" IS NULL)
      OR (OLD."status" = 'PAYMENT_PROCESSING' AND NEW."status" = 'PAYMENT_FAILED' AND NEW."paymentFailedAt" IS NOT NULL AND NEW."paidAt" IS NULL)
    ) THEN
    RAISE EXCEPTION 'primary order status metadata transition is not authorized' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
