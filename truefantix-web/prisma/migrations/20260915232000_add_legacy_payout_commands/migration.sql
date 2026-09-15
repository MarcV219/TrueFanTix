-- Make each legacy Stripe payout mutation a one-shot durable command. A claimed
-- command is never lease-reclaimed: ambiguous outcomes require reconciliation.
BEGIN;

CREATE TYPE "LegacyPayoutCommandStatus" AS ENUM (
  'NOT_SENT',
  'ATTEMPTING',
  'RECONCILIATION_REQUIRED',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "LegacyPayoutTransferCommand" (
  "id" TEXT NOT NULL,
  "payoutId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "connectedAccountId" TEXT NOT NULL,
  "paymentProviderRef" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "transferAmountCents" INTEGER NOT NULL,
  "transferCurrency" TEXT NOT NULL,
  "sourceTransaction" TEXT NOT NULL,
  "fundingMode" TEXT NOT NULL,
  "settlementCurrency" TEXT NOT NULL,
  "actorUserId" TEXT,
  "automatic" BOOLEAN NOT NULL,
  "commandDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "LegacyPayoutCommandStatus" NOT NULL DEFAULT 'NOT_SENT',
  "dispatchStartedAt" TIMESTAMP(3),
  "providerTransferId" TEXT,
  "providerAmountCents" INTEGER,
  "providerCurrency" TEXT,
  "providerDestination" TEXT,
  "providerSourceTransaction" TEXT,
  "providerFundingMode" TEXT,
  "providerSettlementCurrency" TEXT,
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegacyPayoutTransferCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyPayoutTransferCommand_amount" CHECK ("amountCents" > 0),
  CONSTRAINT "LegacyPayoutTransferCommand_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "LegacyPayoutTransferCommand_transfer_amount" CHECK ("transferAmountCents" = "amountCents"),
  CONSTRAINT "LegacyPayoutTransferCommand_transfer_currency" CHECK ("transferCurrency" = LOWER("currency")),
  CONSTRAINT "LegacyPayoutTransferCommand_source" CHECK (LENGTH(BTRIM("sourceTransaction")) > 0),
  CONSTRAINT "LegacyPayoutTransferCommand_funding" CHECK (LENGTH(BTRIM("fundingMode")) > 0),
  CONSTRAINT "LegacyPayoutTransferCommand_settlement" CHECK ("settlementCurrency" ~ '^[a-z]{3}$'),
  CONSTRAINT "LegacyPayoutTransferCommand_account" CHECK (LENGTH(BTRIM("connectedAccountId")) > 0),
  CONSTRAINT "LegacyPayoutTransferCommand_payment_ref" CHECK (LENGTH(BTRIM("paymentProviderRef")) > 0),
  CONSTRAINT "LegacyPayoutTransferCommand_actor" CHECK ("automatic" = FALSE OR "actorUserId" IS NOT NULL),
  CONSTRAINT "LegacyPayoutTransferCommand_digest" CHECK ("commandDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LegacyPayoutTransferCommand_key" CHECK ("idempotencyKey" = 'truefantix:payout:' || "payoutId"),
  CONSTRAINT "LegacyPayoutTransferCommand_provider_amount" CHECK ("providerAmountCents" IS NULL OR "providerAmountCents" > 0),
  CONSTRAINT "LegacyPayoutTransferCommand_provider_currency" CHECK ("providerCurrency" IS NULL OR "providerCurrency" ~ '^[a-z]{3}$'),
  CONSTRAINT "LegacyPayoutTransferCommand_settlement_currency" CHECK ("providerSettlementCurrency" IS NULL OR "providerSettlementCurrency" ~ '^[a-z]{3}$')
);

CREATE UNIQUE INDEX "LegacyPayoutTransferCommand_payoutId_key" ON "LegacyPayoutTransferCommand"("payoutId");
CREATE UNIQUE INDEX "LegacyPayoutTransferCommand_orderId_key" ON "LegacyPayoutTransferCommand"("orderId");
CREATE UNIQUE INDEX "LegacyPayoutTransferCommand_paymentId_key" ON "LegacyPayoutTransferCommand"("paymentId");
CREATE UNIQUE INDEX "LegacyPayoutTransferCommand_idempotencyKey_key" ON "LegacyPayoutTransferCommand"("idempotencyKey");
CREATE UNIQUE INDEX "LegacyPayoutTransferCommand_providerTransferId_key" ON "LegacyPayoutTransferCommand"("providerTransferId");
CREATE INDEX "LegacyPayoutTransferCommand_status_authorizedAt_idx" ON "LegacyPayoutTransferCommand"("status", "authorizedAt");
CREATE INDEX "LegacyPayoutTransferCommand_sellerId_authorizedAt_idx" ON "LegacyPayoutTransferCommand"("sellerId", "authorizedAt");

ALTER TABLE "LegacyPayoutTransferCommand" ADD CONSTRAINT "LegacyPayoutTransferCommand_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyPayoutTransferCommand" ADD CONSTRAINT "LegacyPayoutTransferCommand_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyPayoutTransferCommand" ADD CONSTRAINT "LegacyPayoutTransferCommand_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyPayoutTransferCommand" ADD CONSTRAINT "LegacyPayoutTransferCommand_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "LegacyInstantPayoutCommand" (
  "id" TEXT NOT NULL,
  "payoutId" TEXT NOT NULL,
  "transferCommandId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "connectedAccountId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "automatic" BOOLEAN NOT NULL,
  "commandDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "LegacyPayoutCommandStatus" NOT NULL DEFAULT 'NOT_SENT',
  "dispatchStartedAt" TIMESTAMP(3),
  "providerPayoutId" TEXT,
  "providerStatus" TEXT,
  "providerAmountCents" INTEGER,
  "providerCurrency" TEXT,
  "providerDestination" TEXT,
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegacyInstantPayoutCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyInstantPayoutCommand_amount" CHECK ("amountCents" > 0),
  CONSTRAINT "LegacyInstantPayoutCommand_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "LegacyInstantPayoutCommand_account" CHECK (LENGTH(BTRIM("connectedAccountId")) > 0),
  CONSTRAINT "LegacyInstantPayoutCommand_destination" CHECK (LENGTH(BTRIM("destinationId")) > 0),
  CONSTRAINT "LegacyInstantPayoutCommand_actor" CHECK ("automatic" = FALSE OR "actorUserId" IS NOT NULL),
  CONSTRAINT "LegacyInstantPayoutCommand_digest" CHECK ("commandDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LegacyInstantPayoutCommand_key" CHECK ("idempotencyKey" = 'truefantix:instant-payout:' || "payoutId"),
  CONSTRAINT "LegacyInstantPayoutCommand_provider_amount" CHECK ("providerAmountCents" IS NULL OR "providerAmountCents" > 0),
  CONSTRAINT "LegacyInstantPayoutCommand_provider_currency" CHECK ("providerCurrency" IS NULL OR "providerCurrency" ~ '^[a-z]{3}$')
);

CREATE UNIQUE INDEX "LegacyInstantPayoutCommand_payoutId_key" ON "LegacyInstantPayoutCommand"("payoutId");
CREATE UNIQUE INDEX "LegacyInstantPayoutCommand_transferCommandId_key" ON "LegacyInstantPayoutCommand"("transferCommandId");
CREATE UNIQUE INDEX "LegacyInstantPayoutCommand_orderId_key" ON "LegacyInstantPayoutCommand"("orderId");
CREATE UNIQUE INDEX "LegacyInstantPayoutCommand_paymentId_key" ON "LegacyInstantPayoutCommand"("paymentId");
CREATE UNIQUE INDEX "LegacyInstantPayoutCommand_idempotencyKey_key" ON "LegacyInstantPayoutCommand"("idempotencyKey");
CREATE UNIQUE INDEX "LegacyInstantPayoutCommand_providerPayoutId_key" ON "LegacyInstantPayoutCommand"("providerPayoutId");
CREATE INDEX "LegacyInstantPayoutCommand_status_authorizedAt_idx" ON "LegacyInstantPayoutCommand"("status", "authorizedAt");
CREATE INDEX "LegacyInstantPayoutCommand_sellerId_authorizedAt_idx" ON "LegacyInstantPayoutCommand"("sellerId", "authorizedAt");

ALTER TABLE "LegacyInstantPayoutCommand" ADD CONSTRAINT "LegacyInstantPayoutCommand_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyInstantPayoutCommand" ADD CONSTRAINT "LegacyInstantPayoutCommand_transferCommandId_fkey"
  FOREIGN KEY ("transferCommandId") REFERENCES "LegacyPayoutTransferCommand"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyInstantPayoutCommand" ADD CONSTRAINT "LegacyInstantPayoutCommand_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyInstantPayoutCommand" ADD CONSTRAINT "LegacyInstantPayoutCommand_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyInstantPayoutCommand" ADD CONSTRAINT "LegacyInstantPayoutCommand_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION protect_legacy_payout_transfer_command()
RETURNS trigger AS $$
DECLARE
  payout_row "Payout"%ROWTYPE;
  order_row "Order"%ROWTYPE;
  payment_row "Payment"%ROWTYPE;
  seller_row "Seller"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legacy payout transfer command evidence cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO payout_row FROM "Payout" WHERE id = NEW."payoutId" FOR UPDATE;
    SELECT * INTO order_row FROM "Order" WHERE id = NEW."orderId";
    SELECT * INTO payment_row FROM "Payment" WHERE id = NEW."paymentId";
    SELECT * INTO seller_row FROM "Seller" WHERE id = NEW."sellerId";
    IF payout_row.id IS NULL OR order_row.id IS NULL OR payment_row.id IS NULL OR seller_row.id IS NULL
      OR payout_row."sellerId" IS DISTINCT FROM NEW."sellerId"
      OR payout_row.status IS DISTINCT FROM 'PROCESSING'
      OR payout_row."stripeTransferId" IS NOT NULL
      OR payout_row."netCents" IS DISTINCT FROM NEW."amountCents"
      OR payout_row."providerRef" IS DISTINCT FROM 'order:' || NEW."orderId"
      OR order_row."sellerId" IS DISTINCT FROM NEW."sellerId"
      OR order_row.status IS DISTINCT FROM 'COMPLETED'
      OR payment_row."orderId" IS DISTINCT FROM NEW."orderId"
      OR payment_row.status IS DISTINCT FROM 'SUCCEEDED'
      OR payment_row.provider IS DISTINCT FROM 'STRIPE'
      OR payment_row."providerRef" IS DISTINCT FROM NEW."paymentProviderRef"
      OR UPPER(payment_row.currency) IS DISTINCT FROM NEW.currency
      OR NEW."transferAmountCents" IS DISTINCT FROM NEW."amountCents"
      OR NEW."transferCurrency" IS DISTINCT FROM LOWER(NEW.currency)
      OR seller_row."stripeAccountId" IS DISTINCT FROM NEW."connectedAccountId" THEN
      RAISE EXCEPTION 'Legacy payout transfer authorization snapshot mismatch';
    END IF;
    IF NEW.status <> 'NOT_SENT'
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerTransferId" IS NOT NULL
      OR NEW."providerAmountCents" IS NOT NULL
      OR NEW."providerCurrency" IS NOT NULL
      OR NEW."providerDestination" IS NOT NULL
      OR NEW."providerSourceTransaction" IS NOT NULL
      OR NEW."providerFundingMode" IS NOT NULL
      OR NEW."providerSettlementCurrency" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy payout transfer command must begin as pristine NOT_SENT evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF TO_JSONB(NEW) - ARRAY[
      'status', 'dispatchStartedAt', 'providerTransferId', 'providerAmountCents',
      'providerCurrency', 'providerDestination', 'providerSourceTransaction',
      'providerFundingMode', 'providerSettlementCurrency', 'failureReason',
      'completedAt', 'updatedAt'
    ] IS DISTINCT FROM TO_JSONB(OLD) - ARRAY[
      'status', 'dispatchStartedAt', 'providerTransferId', 'providerAmountCents',
      'providerCurrency', 'providerDestination', 'providerSourceTransaction',
      'providerFundingMode', 'providerSettlementCurrency', 'failureReason',
      'completedAt', 'updatedAt'
    ] THEN
    RAISE EXCEPTION 'Legacy payout transfer authorization evidence is immutable';
  END IF;

  IF OLD.status = 'NOT_SENT' AND NEW.status = 'ATTEMPTING' THEN
    IF NEW."dispatchStartedAt" IS NULL
      OR NEW."providerTransferId" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid legacy payout transfer claim';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status IN ('FAILED', 'RECONCILIATION_REQUIRED') THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."failureReason", ''))) = 0
      OR NEW."completedAt" IS NULL
      OR (NEW.status = 'FAILED' AND (
        NEW."providerTransferId" IS NOT NULL OR NEW."providerAmountCents" IS NOT NULL
        OR NEW."providerCurrency" IS NOT NULL OR NEW."providerDestination" IS NOT NULL
        OR NEW."providerSourceTransaction" IS NOT NULL OR NEW."providerFundingMode" IS NOT NULL
        OR NEW."providerSettlementCurrency" IS NOT NULL
      ))
      OR (NEW."providerTransferId" IS NULL AND (
        NEW."providerAmountCents" IS NOT NULL OR NEW."providerCurrency" IS NOT NULL
        OR NEW."providerDestination" IS NOT NULL OR NEW."providerSourceTransaction" IS NOT NULL
        OR NEW."providerFundingMode" IS NOT NULL OR NEW."providerSettlementCurrency" IS NOT NULL
      ))
      OR (NEW."providerTransferId" IS NOT NULL AND (
        LENGTH(BTRIM(NEW."providerTransferId")) = 0
        OR NEW."providerAmountCents" IS NULL
        OR NEW."providerCurrency" IS NULL
        OR LENGTH(BTRIM(COALESCE(NEW."providerDestination", ''))) = 0
        OR LENGTH(BTRIM(COALESCE(NEW."providerSourceTransaction", ''))) = 0
        OR LENGTH(BTRIM(COALESCE(NEW."providerFundingMode", ''))) = 0
        OR NEW."providerSettlementCurrency" IS NULL
      )) THEN
      RAISE EXCEPTION 'Invalid legacy payout transfer terminal evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO payout_row FROM "Payout" WHERE id = NEW."payoutId";
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."providerTransferId", ''))) = 0
      OR NEW."providerAmountCents" IS DISTINCT FROM NEW."transferAmountCents"
      OR NEW."providerCurrency" IS DISTINCT FROM NEW."transferCurrency"
      OR NEW."providerDestination" IS DISTINCT FROM NEW."connectedAccountId"
      OR NEW."providerSourceTransaction" IS DISTINCT FROM NEW."sourceTransaction"
      OR NEW."providerFundingMode" IS DISTINCT FROM NEW."fundingMode"
      OR NEW."providerSettlementCurrency" IS DISTINCT FROM NEW."settlementCurrency"
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NULL
      OR payout_row.status IS DISTINCT FROM 'PAID'
      OR payout_row."stripeTransferId" IS DISTINCT FROM NEW."providerTransferId" THEN
      RAISE EXCEPTION 'Invalid legacy payout transfer success evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid legacy payout transfer state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacyPayoutTransferCommand_history"
BEFORE INSERT OR UPDATE OR DELETE ON "LegacyPayoutTransferCommand"
FOR EACH ROW EXECUTE FUNCTION protect_legacy_payout_transfer_command();

CREATE FUNCTION protect_legacy_instant_payout_command()
RETURNS trigger AS $$
DECLARE
  transfer_row "LegacyPayoutTransferCommand"%ROWTYPE;
  payout_row "Payout"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legacy instant payout command evidence cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO transfer_row FROM "LegacyPayoutTransferCommand" WHERE id = NEW."transferCommandId" FOR UPDATE;
    SELECT * INTO payout_row FROM "Payout" WHERE id = NEW."payoutId" FOR UPDATE;
    IF transfer_row.id IS NULL OR transfer_row.status IS DISTINCT FROM 'SUCCEEDED'
      OR transfer_row."payoutId" IS DISTINCT FROM NEW."payoutId"
      OR transfer_row."orderId" IS DISTINCT FROM NEW."orderId"
      OR transfer_row."paymentId" IS DISTINCT FROM NEW."paymentId"
      OR transfer_row."sellerId" IS DISTINCT FROM NEW."sellerId"
      OR transfer_row."connectedAccountId" IS DISTINCT FROM NEW."connectedAccountId"
      OR transfer_row."amountCents" IS DISTINCT FROM NEW."amountCents"
      OR transfer_row.currency IS DISTINCT FROM NEW.currency
      OR transfer_row."actorUserId" IS DISTINCT FROM NEW."actorUserId"
      OR transfer_row.automatic IS DISTINCT FROM NEW.automatic
      OR NEW."authorizedAt" < transfer_row."completedAt"
      OR payout_row.status IS DISTINCT FROM 'PAID'
      OR payout_row."stripeTransferId" IS DISTINCT FROM transfer_row."providerTransferId"
      OR payout_row."stripeInstantPayoutId" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy instant payout authorization snapshot mismatch';
    END IF;
    IF NEW.status <> 'NOT_SENT'
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerPayoutId" IS NOT NULL
      OR NEW."providerStatus" IS NOT NULL
      OR NEW."providerAmountCents" IS NOT NULL
      OR NEW."providerCurrency" IS NOT NULL
      OR NEW."providerDestination" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy instant payout command must begin as pristine NOT_SENT evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF TO_JSONB(NEW) - ARRAY[
      'status', 'dispatchStartedAt', 'providerPayoutId', 'providerStatus',
      'providerAmountCents', 'providerCurrency', 'providerDestination',
      'failureReason', 'completedAt', 'updatedAt'
    ] IS DISTINCT FROM TO_JSONB(OLD) - ARRAY[
      'status', 'dispatchStartedAt', 'providerPayoutId', 'providerStatus',
      'providerAmountCents', 'providerCurrency', 'providerDestination',
      'failureReason', 'completedAt', 'updatedAt'
    ] THEN
    RAISE EXCEPTION 'Legacy instant payout authorization evidence is immutable';
  END IF;

  IF OLD.status = 'NOT_SENT' AND NEW.status = 'ATTEMPTING' THEN
    IF NEW."dispatchStartedAt" IS NULL OR NEW."providerPayoutId" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid legacy instant payout claim';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status IN ('FAILED', 'RECONCILIATION_REQUIRED') THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."failureReason", ''))) = 0
      OR NEW."completedAt" IS NULL
      OR (NEW.status = 'FAILED' AND (
        NEW."providerPayoutId" IS NOT NULL OR NEW."providerStatus" IS NOT NULL
        OR NEW."providerAmountCents" IS NOT NULL OR NEW."providerCurrency" IS NOT NULL
        OR NEW."providerDestination" IS NOT NULL
      ))
      OR (NEW."providerPayoutId" IS NULL AND (
        NEW."providerStatus" IS NOT NULL OR NEW."providerAmountCents" IS NOT NULL
        OR NEW."providerCurrency" IS NOT NULL OR NEW."providerDestination" IS NOT NULL
      ))
      OR (NEW."providerPayoutId" IS NOT NULL AND (
        LENGTH(BTRIM(NEW."providerPayoutId")) = 0
        OR LENGTH(BTRIM(COALESCE(NEW."providerStatus", ''))) = 0
        OR NEW."providerAmountCents" IS NULL
        OR NEW."providerCurrency" IS NULL
        OR LENGTH(BTRIM(COALESCE(NEW."providerDestination", ''))) = 0
      )) THEN
      RAISE EXCEPTION 'Invalid legacy instant payout terminal evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO payout_row FROM "Payout" WHERE id = NEW."payoutId";
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."providerPayoutId", ''))) = 0
      OR LENGTH(BTRIM(COALESCE(NEW."providerStatus", ''))) = 0
      OR NEW."providerAmountCents" IS DISTINCT FROM NEW."amountCents"
      OR NEW."providerCurrency" IS DISTINCT FROM LOWER(NEW.currency)
      OR NEW."providerDestination" IS DISTINCT FROM NEW."destinationId"
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NULL
      OR payout_row.status IS DISTINCT FROM 'PAID'
      OR payout_row."stripeInstantPayoutId" IS DISTINCT FROM NEW."providerPayoutId" THEN
      RAISE EXCEPTION 'Invalid legacy instant payout success evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid legacy instant payout state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacyInstantPayoutCommand_history"
BEFORE INSERT OR UPDATE OR DELETE ON "LegacyInstantPayoutCommand"
FOR EACH ROW EXECUTE FUNCTION protect_legacy_instant_payout_command();

CREATE FUNCTION protect_command_owned_payout_projection()
RETURNS trigger AS $$
DECLARE
  command_row "LegacyPayoutTransferCommand"%ROWTYPE;
  instant_row "LegacyInstantPayoutCommand"%ROWTYPE;
BEGIN
  SELECT * INTO command_row FROM "LegacyPayoutTransferCommand" WHERE "payoutId" = OLD.id;
  IF command_row.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW."stripeTransferId" IS DISTINCT FROM OLD."stripeTransferId"
    OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt" THEN
    IF OLD.status = 'PROCESSING' AND NEW.status = 'PAID'
      AND command_row.status = 'ATTEMPTING'
      AND OLD."stripeTransferId" IS NULL
      AND LENGTH(BTRIM(COALESCE(NEW."stripeTransferId", ''))) > 0
      AND NEW."paidAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Command-owned payout projection cannot be changed by legacy status dispatch';
  END IF;

  IF NEW."stripeInstantPayoutId" IS DISTINCT FROM OLD."stripeInstantPayoutId"
    OR NEW."instantPayoutStatus" IS DISTINCT FROM OLD."instantPayoutStatus"
    OR NEW."instantPayoutAt" IS DISTINCT FROM OLD."instantPayoutAt" THEN
    SELECT * INTO instant_row FROM "LegacyInstantPayoutCommand" WHERE "payoutId" = OLD.id;
    IF instant_row.id IS NULL AND command_row.status = 'SUCCEEDED'
      AND NEW."stripeInstantPayoutId" IS NULL
      AND NEW."instantPayoutStatus" IN ('STANDARD_ONLY', 'FAILED')
      AND NEW."instantPayoutAt" IS NULL THEN
      RETURN NEW;
    END IF;
    IF instant_row.status IN ('FAILED', 'RECONCILIATION_REQUIRED')
      AND NEW."stripeInstantPayoutId" IS NULL
      AND NEW."instantPayoutAt" IS NULL
      AND NEW."instantPayoutStatus" = instant_row.status::TEXT THEN
      RETURN NEW;
    END IF;
    IF instant_row.id IS NULL OR instant_row.status <> 'ATTEMPTING'
      OR OLD."stripeInstantPayoutId" IS NOT NULL
      OR LENGTH(BTRIM(COALESCE(NEW."stripeInstantPayoutId", ''))) = 0
      OR LENGTH(BTRIM(COALESCE(NEW."instantPayoutStatus", ''))) = 0
      OR NEW."instantPayoutAt" IS NULL THEN
      RAISE EXCEPTION 'Command-owned instant payout projection cannot be changed by legacy dispatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payout_command_projection"
BEFORE UPDATE ON "Payout"
FOR EACH ROW EXECUTE FUNCTION protect_command_owned_payout_projection();

CREATE FUNCTION validate_command_owned_payout_projection()
RETURNS trigger AS $$
DECLARE
  command_row "LegacyPayoutTransferCommand"%ROWTYPE;
  instant_row "LegacyInstantPayoutCommand"%ROWTYPE;
BEGIN
  SELECT * INTO command_row FROM "LegacyPayoutTransferCommand" WHERE "payoutId" = NEW.id;
  IF command_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'PAID' OR NEW."stripeTransferId" IS NOT NULL THEN
    IF command_row.status <> 'SUCCEEDED'
      OR NEW.status <> 'PAID'
      OR NEW."stripeTransferId" IS DISTINCT FROM command_row."providerTransferId"
      OR NEW."paidAt" IS NULL THEN
      RAISE EXCEPTION 'Command-owned payout success projection is incomplete';
    END IF;
  ELSIF NEW.status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Command-owned payout must remain non-dispatchable';
  END IF;

  SELECT * INTO instant_row FROM "LegacyInstantPayoutCommand" WHERE "payoutId" = NEW.id;
  IF NEW."stripeInstantPayoutId" IS NOT NULL THEN
    IF instant_row.id IS NULL OR instant_row.status <> 'SUCCEEDED'
      OR NEW."stripeInstantPayoutId" IS DISTINCT FROM instant_row."providerPayoutId"
      OR NEW."instantPayoutStatus" IS DISTINCT FROM UPPER(instant_row."providerStatus")
      OR NEW."instantPayoutAt" IS NULL THEN
      RAISE EXCEPTION 'Command-owned instant payout success projection is incomplete';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Payout_command_projection_commit"
AFTER INSERT OR UPDATE ON "Payout"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_command_owned_payout_projection();

CREATE FUNCTION prevent_legacy_payout_command_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy payout command evidence cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacyPayoutTransferCommand_no_truncate"
BEFORE TRUNCATE ON "LegacyPayoutTransferCommand"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_legacy_payout_command_truncate();

CREATE TRIGGER "LegacyInstantPayoutCommand_no_truncate"
BEFORE TRUNCATE ON "LegacyInstantPayoutCommand"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_legacy_payout_command_truncate();

COMMIT;
