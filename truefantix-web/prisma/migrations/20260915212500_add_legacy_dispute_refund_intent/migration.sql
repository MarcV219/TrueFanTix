-- Authorize legacy dispute refunds durably before any provider call. The row is
-- intentionally one-per-order and append-only apart from its narrow state
-- machine so an ambiguous provider boundary can never be retried implicitly.
BEGIN;

CREATE TYPE "LegacyDisputeRefundStatus" AS ENUM (
  'NOT_SENT',
  'ATTEMPTING',
  'RECONCILIATION_REQUIRED',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "LegacyDisputeRefundIntent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "authorizedByUserId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentRef" TEXT NOT NULL,
  "expectedAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "authorizationReason" TEXT NOT NULL,
  "authorizationIpAddress" TEXT,
  "authorizationUserAgent" TEXT,
  "commandDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "LegacyDisputeRefundStatus" NOT NULL DEFAULT 'NOT_SENT',
  "dispatchStartedAt" TIMESTAMP(3),
  "providerRefundId" TEXT,
  "providerStatus" TEXT,
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegacyDisputeRefundIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyDisputeRefundIntent_positive_amount" CHECK ("expectedAmountCents" > 0),
  CONSTRAINT "LegacyDisputeRefundIntent_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "LegacyDisputeRefundIntent_command_digest_shape" CHECK ("commandDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LegacyDisputeRefundIntent_provider" CHECK ("provider" = 'STRIPE'),
  CONSTRAINT "LegacyDisputeRefundIntent_key" CHECK ("idempotencyKey" = 'dispute-refund:' || "orderId"),
  CONSTRAINT "LegacyDisputeRefundIntent_reason" CHECK (LENGTH(BTRIM("authorizationReason")) > 0),
  CONSTRAINT "LegacyDisputeRefundIntent_provider_ref" CHECK (LENGTH(BTRIM("providerPaymentRef")) > 0)
);

CREATE UNIQUE INDEX "LegacyDisputeRefundIntent_orderId_key"
  ON "LegacyDisputeRefundIntent"("orderId");
CREATE UNIQUE INDEX "LegacyDisputeRefundIntent_paymentId_key"
  ON "LegacyDisputeRefundIntent"("paymentId");
CREATE UNIQUE INDEX "LegacyDisputeRefundIntent_idempotencyKey_key"
  ON "LegacyDisputeRefundIntent"("idempotencyKey");
CREATE UNIQUE INDEX "LegacyDisputeRefundIntent_providerRefundId_key"
  ON "LegacyDisputeRefundIntent"("providerRefundId");
CREATE INDEX "LegacyDisputeRefundIntent_status_authorizedAt_idx"
  ON "LegacyDisputeRefundIntent"("status", "authorizedAt");
CREATE INDEX "LegacyDisputeRefundIntent_authorizedByUserId_authorizedAt_idx"
  ON "LegacyDisputeRefundIntent"("authorizedByUserId", "authorizedAt");

ALTER TABLE "LegacyDisputeRefundIntent"
  ADD CONSTRAINT "LegacyDisputeRefundIntent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyDisputeRefundIntent"
  ADD CONSTRAINT "LegacyDisputeRefundIntent_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyDisputeRefundIntent"
  ADD CONSTRAINT "LegacyDisputeRefundIntent_authorizedByUserId_fkey"
  FOREIGN KEY ("authorizedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION protect_legacy_dispute_refund_intent()
RETURNS trigger AS $$
DECLARE
  payment_row "Payment"%ROWTYPE;
  order_row "Order"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legacy dispute refund evidence cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO payment_row FROM "Payment" WHERE id = NEW."paymentId";
    SELECT * INTO order_row FROM "Order" WHERE id = NEW."orderId";

    IF NEW.status <> 'NOT_SENT'
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerRefundId" IS NOT NULL
      OR NEW."providerStatus" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy dispute refund must begin as pristine NOT_SENT evidence';
    END IF;
    IF payment_row.id IS NULL
      OR payment_row."orderId" IS DISTINCT FROM NEW."orderId"
      OR payment_row.status <> 'SUCCEEDED'
      OR payment_row.provider <> NEW.provider
      OR payment_row."providerRef" IS DISTINCT FROM NEW."providerPaymentRef"
      OR payment_row."amountCents" IS DISTINCT FROM NEW."expectedAmountCents"
      OR UPPER(payment_row.currency) IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'Legacy dispute refund payment snapshot mismatch';
    END IF;
    IF order_row.id IS NULL
      OR order_row."buyerConfirmationStatus" IS DISTINCT FROM 'DISPUTED'
      OR order_row."totalCents" IS DISTINCT FROM NEW."expectedAmountCents"
      OR UPPER(order_row.currency) IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'Legacy dispute refund order snapshot mismatch';
    END IF;
    RETURN NEW;
  END IF;

  IF TO_JSONB(NEW) - ARRAY[
      'status', 'dispatchStartedAt', 'providerRefundId', 'providerStatus',
      'failureReason', 'completedAt', 'updatedAt'
    ] IS DISTINCT FROM TO_JSONB(OLD) - ARRAY[
      'status', 'dispatchStartedAt', 'providerRefundId', 'providerStatus',
      'failureReason', 'completedAt', 'updatedAt'
    ] THEN
    RAISE EXCEPTION 'Legacy dispute refund authorization evidence is immutable';
  END IF;

  IF OLD.status = 'NOT_SENT' AND NEW.status = 'ATTEMPTING' THEN
    IF OLD."dispatchStartedAt" IS NOT NULL
      OR NEW."dispatchStartedAt" IS NULL
      OR NEW."providerRefundId" IS NOT NULL
      OR NEW."providerStatus" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid legacy dispute refund dispatch claim';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'RECONCILIATION_REQUIRED' THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR ((NEW."providerRefundId" IS NULL) <> (NEW."providerStatus" IS NULL))
      OR (NEW."providerRefundId" IS NOT NULL AND LENGTH(BTRIM(NEW."providerRefundId")) = 0)
      OR (NEW."providerStatus" IS NOT NULL AND LENGTH(BTRIM(NEW."providerStatus")) = 0)
      OR LENGTH(BTRIM(COALESCE(NEW."failureReason", ''))) = 0
      OR NEW."completedAt" IS NULL THEN
      RAISE EXCEPTION 'Invalid legacy dispute refund reconciliation evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'FAILED' THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."providerRefundId", ''))) = 0
      OR NEW."providerStatus" NOT IN ('failed', 'canceled')
      OR LENGTH(BTRIM(COALESCE(NEW."failureReason", ''))) = 0
      OR NEW."completedAt" IS NULL THEN
      RAISE EXCEPTION 'Invalid legacy dispute refund terminal failure evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'SUCCEEDED' THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."providerRefundId", ''))) = 0
      OR NEW."providerStatus" IS DISTINCT FROM 'succeeded'
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NULL THEN
      RAISE EXCEPTION 'Invalid legacy dispute refund success evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid legacy dispute refund state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacyDisputeRefundIntent_history"
BEFORE INSERT OR UPDATE OR DELETE ON "LegacyDisputeRefundIntent"
FOR EACH ROW EXECUTE FUNCTION protect_legacy_dispute_refund_intent();

COMMIT;
