-- Commit the legacy checkout authorization before Stripe payment-intent I/O.
-- A single durable claim owns provider contact; every uncertain outcome is
-- quarantined and cannot be automatically replayed.
BEGIN;

CREATE TYPE "LegacyPaymentIntentCommandStatus" AS ENUM (
  'NOT_SENT',
  'ATTEMPTING',
  'RECONCILIATION_REQUIRED',
  'SUCCEEDED'
);

CREATE TABLE "LegacyPaymentIntentCommand" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "buyerSellerId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "expectedAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "priorPaymentId" TEXT,
  "priorPaymentProvider" TEXT,
  "priorPaymentRef" TEXT,
  "priorPaymentAmountCents" INTEGER,
  "priorPaymentCurrency" TEXT,
  "ticketSnapshot" JSONB NOT NULL,
  "commandDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "LegacyPaymentIntentCommandStatus" NOT NULL DEFAULT 'NOT_SENT',
  "dispatchStartedAt" TIMESTAMP(3),
  "providerIntentId" TEXT,
  "providerStatus" TEXT,
  "providerAmountCents" INTEGER,
  "providerCurrency" TEXT,
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegacyPaymentIntentCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyPaymentIntentCommand_positive_amount" CHECK ("expectedAmountCents" > 0),
  CONSTRAINT "LegacyPaymentIntentCommand_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "LegacyPaymentIntentCommand_digest_shape" CHECK ("commandDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LegacyPaymentIntentCommand_key" CHECK ("idempotencyKey" = 'truefantix-order-' || "orderId"),
  CONSTRAINT "LegacyPaymentIntentCommand_prior_shape" CHECK (
    ("priorPaymentId" IS NULL
      AND "priorPaymentProvider" IS NULL
      AND "priorPaymentRef" IS NULL
      AND "priorPaymentAmountCents" IS NULL
      AND "priorPaymentCurrency" IS NULL)
    OR
    (LENGTH(BTRIM("priorPaymentId")) > 0
      AND LENGTH(BTRIM("priorPaymentProvider")) > 0
      AND LENGTH(BTRIM("priorPaymentRef")) > 0
      AND "priorPaymentAmountCents" > 0
      AND "priorPaymentCurrency" ~ '^[A-Z]{3}$')
  ),
  CONSTRAINT "LegacyPaymentIntentCommand_provider_amount" CHECK (
    "providerAmountCents" IS NULL OR "providerAmountCents" > 0
  ),
  CONSTRAINT "LegacyPaymentIntentCommand_provider_currency" CHECK (
    "providerCurrency" IS NULL OR "providerCurrency" ~ '^[A-Z]{3}$'
  )
);

CREATE UNIQUE INDEX "LegacyPaymentIntentCommand_orderId_key"
  ON "LegacyPaymentIntentCommand"("orderId");
CREATE UNIQUE INDEX "LegacyPaymentIntentCommand_idempotencyKey_key"
  ON "LegacyPaymentIntentCommand"("idempotencyKey");
CREATE UNIQUE INDEX "LegacyPaymentIntentCommand_providerIntentId_key"
  ON "LegacyPaymentIntentCommand"("providerIntentId");
CREATE INDEX "LegacyPaymentIntentCommand_status_authorizedAt_idx"
  ON "LegacyPaymentIntentCommand"("status", "authorizedAt");
CREATE INDEX "LegacyPaymentIntentCommand_buyerUserId_authorizedAt_idx"
  ON "LegacyPaymentIntentCommand"("buyerUserId", "authorizedAt");

ALTER TABLE "LegacyPaymentIntentCommand"
  ADD CONSTRAINT "LegacyPaymentIntentCommand_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION protect_legacy_payment_intent_command()
RETURNS trigger AS $$
DECLARE
  order_row "Order"%ROWTYPE;
  payment_row "Payment"%ROWTYPE;
  snapshot_count INTEGER;
  current_ticket_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legacy payment-intent command evidence cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO order_row FROM "Order" WHERE id = NEW."orderId";
    IF order_row.id IS NULL
      OR order_row.status <> 'PENDING'
      OR order_row."buyerSellerId" IS DISTINCT FROM NEW."buyerSellerId"
      OR order_row."sellerId" IS DISTINCT FROM NEW."sellerId"
      OR order_row."totalCents" IS DISTINCT FROM NEW."expectedAmountCents"
      OR UPPER(order_row.currency) IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'Legacy payment-intent order snapshot mismatch';
    END IF;
    IF NEW.status <> 'NOT_SENT'
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerIntentId" IS NOT NULL
      OR NEW."providerStatus" IS NOT NULL
      OR NEW."providerAmountCents" IS NOT NULL
      OR NEW."providerCurrency" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy payment-intent command must begin as pristine NOT_SENT evidence';
    END IF;

    SELECT * INTO payment_row FROM "Payment" WHERE "orderId" = NEW."orderId";
    IF NEW."priorPaymentId" IS NULL THEN
      IF payment_row.id IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy payment-intent prior payment snapshot mismatch';
      END IF;
    ELSIF payment_row.id IS NULL
      OR payment_row.id IS DISTINCT FROM NEW."priorPaymentId"
      OR payment_row.provider IS DISTINCT FROM NEW."priorPaymentProvider"
      OR payment_row."providerRef" IS DISTINCT FROM NEW."priorPaymentRef"
      OR payment_row."amountCents" IS DISTINCT FROM NEW."priorPaymentAmountCents"
      OR UPPER(payment_row.currency) IS DISTINCT FROM NEW."priorPaymentCurrency" THEN
      RAISE EXCEPTION 'Legacy payment-intent prior payment snapshot mismatch';
    END IF;

    IF JSONB_TYPEOF(NEW."ticketSnapshot") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Legacy payment-intent ticket snapshot must be an array';
    END IF;
    snapshot_count := JSONB_ARRAY_LENGTH(NEW."ticketSnapshot");
    SELECT COUNT(*) INTO current_ticket_count FROM "OrderItem" WHERE "orderId" = NEW."orderId";
    IF snapshot_count = 0 OR snapshot_count <> current_ticket_count THEN
      RAISE EXCEPTION 'Legacy payment-intent ticket snapshot count mismatch';
    END IF;
    IF (
      SELECT COUNT(DISTINCT snapshot.id)
      FROM JSONB_TO_RECORDSET(NEW."ticketSnapshot") AS snapshot(
        id TEXT,
        status TEXT,
        "reservedByOrderId" TEXT,
        "reservedUntil" TEXT
      )
    ) <> snapshot_count THEN
      RAISE EXCEPTION 'Legacy payment-intent ticket snapshot contains duplicate or missing identities';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM JSONB_TO_RECORDSET(NEW."ticketSnapshot") AS snapshot(
        id TEXT,
        status TEXT,
        "reservedByOrderId" TEXT,
        "reservedUntil" TEXT
      )
      LEFT JOIN "OrderItem" item
        ON item."orderId" = NEW."orderId" AND item."ticketId" = snapshot.id
      LEFT JOIN "Ticket" ticket ON ticket.id = snapshot.id
      WHERE item.id IS NULL
        OR ticket.id IS NULL
        OR snapshot.status IS DISTINCT FROM 'RESERVED'
        OR ticket.status::TEXT IS DISTINCT FROM snapshot.status
        OR snapshot."reservedByOrderId" IS DISTINCT FROM NEW."orderId"
        OR ticket."reservedByOrderId" IS DISTINCT FROM snapshot."reservedByOrderId"
        OR snapshot."reservedUntil" IS NULL
        OR ticket."reservedUntil" IS DISTINCT FROM snapshot."reservedUntil"::TIMESTAMPTZ
        OR ticket."reservedUntil" <= NEW."authorizedAt"
    ) THEN
      RAISE EXCEPTION 'Legacy payment-intent ticket reservation snapshot mismatch';
    END IF;
    RETURN NEW;
  END IF;

  IF TO_JSONB(NEW) - ARRAY[
      'status', 'dispatchStartedAt', 'providerIntentId', 'providerStatus',
      'providerAmountCents', 'providerCurrency',
      'failureReason', 'completedAt', 'updatedAt'
    ] IS DISTINCT FROM TO_JSONB(OLD) - ARRAY[
      'status', 'dispatchStartedAt', 'providerIntentId', 'providerStatus',
      'providerAmountCents', 'providerCurrency',
      'failureReason', 'completedAt', 'updatedAt'
    ] THEN
    RAISE EXCEPTION 'Legacy payment-intent authorization evidence is immutable';
  END IF;

  IF OLD.status = 'NOT_SENT' AND NEW.status = 'ATTEMPTING' THEN
    IF NEW."dispatchStartedAt" IS NULL
      OR NEW."providerIntentId" IS NOT NULL
      OR NEW."providerStatus" IS NOT NULL
      OR NEW."providerAmountCents" IS NOT NULL
      OR NEW."providerCurrency" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid legacy payment-intent dispatch claim';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'RECONCILIATION_REQUIRED' THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."failureReason", ''))) = 0
      OR NEW."completedAt" IS NULL
      OR ((NEW."providerIntentId" IS NULL) <> (NEW."providerStatus" IS NULL))
      OR ((NEW."providerIntentId" IS NULL) <> (NEW."providerAmountCents" IS NULL))
      OR ((NEW."providerIntentId" IS NULL) <> (NEW."providerCurrency" IS NULL))
      OR (NEW."providerIntentId" IS NOT NULL AND LENGTH(BTRIM(NEW."providerIntentId")) = 0)
      OR (NEW."providerStatus" IS NOT NULL AND LENGTH(BTRIM(NEW."providerStatus")) = 0) THEN
      RAISE EXCEPTION 'Invalid legacy payment-intent reconciliation evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO payment_row FROM "Payment" WHERE "orderId" = NEW."orderId";
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."providerIntentId", ''))) = 0
      OR NEW."providerStatus" NOT IN ('requires_payment_method', 'requires_confirmation', 'requires_action', 'processing')
      OR NEW."providerAmountCents" IS DISTINCT FROM NEW."expectedAmountCents"
      OR NEW."providerCurrency" IS DISTINCT FROM NEW.currency
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NULL
      OR payment_row.id IS NULL
      OR payment_row.provider IS DISTINCT FROM 'STRIPE'
      OR payment_row."providerRef" IS DISTINCT FROM NEW."providerIntentId"
      OR payment_row."amountCents" IS DISTINCT FROM NEW."expectedAmountCents"
      OR UPPER(payment_row.currency) IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'Invalid legacy payment-intent success evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid legacy payment-intent state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacyPaymentIntentCommand_history"
BEFORE INSERT OR UPDATE OR DELETE ON "LegacyPaymentIntentCommand"
FOR EACH ROW EXECUTE FUNCTION protect_legacy_payment_intent_command();

CREATE FUNCTION prevent_legacy_payment_intent_command_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy payment-intent command evidence cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacyPaymentIntentCommand_no_truncate"
BEFORE TRUNCATE ON "LegacyPaymentIntentCommand"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_legacy_payment_intent_command_truncate();

COMMIT;
