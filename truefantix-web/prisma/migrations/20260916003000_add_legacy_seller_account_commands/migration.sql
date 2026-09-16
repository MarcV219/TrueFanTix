-- Make ordinary seller connected-account creation a durable one-shot command.
-- Provider ambiguity is terminal local reconciliation work and is never leased
-- or automatically resent.
BEGIN;

CREATE TYPE "LegacySellerAccountCommandStatus" AS ENUM (
  'NOT_SENT',
  'ATTEMPTING',
  'RECONCILIATION_REQUIRED',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "LegacySellerAccountCommand" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "authorizedCanSell" BOOLEAN NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "streetAddress1" TEXT NOT NULL,
  "streetAddress2" TEXT,
  "city" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "requestedCapabilities" JSONB NOT NULL,
  "payoutScheduleInterval" TEXT NOT NULL,
  "payoutDelayDays" TEXT NOT NULL,
  "businessProfileMcc" TEXT NOT NULL,
  "businessProfileUrl" TEXT NOT NULL,
  "businessProfileDescription" TEXT NOT NULL,
  "providerMetadata" JSONB NOT NULL,
  "commandDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "LegacySellerAccountCommandStatus" NOT NULL DEFAULT 'NOT_SENT',
  "dispatchStartedAt" TIMESTAMP(3),
  "providerAccountId" TEXT,
  "providerAccountType" TEXT,
  "providerCountry" TEXT,
  "providerCapabilities" JSONB,
  "providerReturnedMetadata" JSONB,
  "providerDetailsSubmitted" BOOLEAN,
  "providerChargesEnabled" BOOLEAN,
  "providerPayoutsEnabled" BOOLEAN,
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegacySellerAccountCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacySellerAccountCommand_actor" CHECK ("actorUserId" = "userId"),
  CONSTRAINT "LegacySellerAccountCommand_country" CHECK ("country" ~ '^[A-Z]{2}$'),
  CONSTRAINT "LegacySellerAccountCommand_type" CHECK ("accountType" = 'EXPRESS'),
  CONSTRAINT "LegacySellerAccountCommand_capabilities" CHECK ("requestedCapabilities" = '{"transfers": true}'::JSONB),
  CONSTRAINT "LegacySellerAccountCommand_schedule" CHECK ("payoutScheduleInterval" = 'DAILY' AND "payoutDelayDays" = 'MINIMUM'),
  CONSTRAINT "LegacySellerAccountCommand_mcc" CHECK ("businessProfileMcc" = '7922'),
  CONSTRAINT "LegacySellerAccountCommand_url" CHECK (
    "businessProfileUrl" ~ '^https://[^/?#]+/seller/[^/?#]+$'
    AND RIGHT("businessProfileUrl", LENGTH('/seller/' || "sellerId")) = '/seller/' || "sellerId"
  ),
  CONSTRAINT "LegacySellerAccountCommand_description" CHECK (
    "businessProfileDescription" = 'Individual seller listing personal event tickets at or below face value through the TrueFanTix marketplace.'
  ),
  CONSTRAINT "LegacySellerAccountCommand_metadata" CHECK ("providerMetadata" = JSONB_BUILD_OBJECT('userId', "userId", 'sellerId', "sellerId", 'platform', 'TrueFanTix')),
  CONSTRAINT "LegacySellerAccountCommand_digest" CHECK ("commandDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LegacySellerAccountCommand_key" CHECK ("idempotencyKey" = 'truefantix:seller-account:' || "sellerId")
);

CREATE UNIQUE INDEX "LegacySellerAccountCommand_userId_key" ON "LegacySellerAccountCommand"("userId");
CREATE UNIQUE INDEX "LegacySellerAccountCommand_sellerId_key" ON "LegacySellerAccountCommand"("sellerId");
CREATE UNIQUE INDEX "LegacySellerAccountCommand_idempotencyKey_key" ON "LegacySellerAccountCommand"("idempotencyKey");
CREATE UNIQUE INDEX "LegacySellerAccountCommand_providerAccountId_key" ON "LegacySellerAccountCommand"("providerAccountId");
CREATE INDEX "LegacySellerAccountCommand_status_authorizedAt_idx" ON "LegacySellerAccountCommand"("status", "authorizedAt");
CREATE INDEX "LegacySellerAccountCommand_actorUserId_authorizedAt_idx" ON "LegacySellerAccountCommand"("actorUserId", "authorizedAt");

ALTER TABLE "LegacySellerAccountCommand" ADD CONSTRAINT "LegacySellerAccountCommand_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacySellerAccountCommand" ADD CONSTRAINT "LegacySellerAccountCommand_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacySellerAccountCommand" ADD CONSTRAINT "LegacySellerAccountCommand_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION protect_legacy_seller_account_command()
RETURNS trigger AS $$
DECLARE
  user_row "User"%ROWTYPE;
  seller_row "Seller"%ROWTYPE;
  has_provider_evidence BOOLEAN;
  has_complete_provider_evidence BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Legacy seller account command evidence cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO user_row FROM "User" WHERE id = NEW."userId" FOR UPDATE;
    SELECT * INTO seller_row FROM "Seller" WHERE id = NEW."sellerId" FOR UPDATE;
    IF user_row.id IS NULL OR seller_row.id IS NULL
      OR user_row."sellerId" IS DISTINCT FROM NEW."sellerId"
      OR user_row."emailVerifiedAt" IS NULL OR user_row."phoneVerifiedAt" IS NULL
      OR user_row."isBanned" OR user_row."canSell" IS DISTINCT FROM NEW."authorizedCanSell"
      OR BTRIM(user_row."firstName") IS DISTINCT FROM NEW."firstName"
      OR BTRIM(user_row."lastName") IS DISTINCT FROM NEW."lastName"
      OR LOWER(BTRIM(user_row.email)) IS DISTINCT FROM NEW.email
      OR BTRIM(user_row.phone) IS DISTINCT FROM NEW.phone
      OR BTRIM(user_row."streetAddress1") IS DISTINCT FROM NEW."streetAddress1"
      OR NULLIF(BTRIM(COALESCE(user_row."streetAddress2", '')), '') IS DISTINCT FROM NEW."streetAddress2"
      OR BTRIM(user_row.city) IS DISTINCT FROM NEW.city
      OR BTRIM(user_row.region) IS DISTINCT FROM NEW.region
      OR BTRIM(user_row."postalCode") IS DISTINCT FROM NEW."postalCode"
      OR (CASE
        WHEN UPPER(BTRIM(user_row.country)) IN ('CA', 'CANADA') THEN 'CA'
        WHEN UPPER(BTRIM(user_row.country)) IN ('US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA') THEN 'US'
        WHEN UPPER(BTRIM(user_row.country)) ~ '^[A-Z]{2}$' THEN UPPER(BTRIM(user_row.country))
        ELSE 'CA'
      END) IS DISTINCT FROM NEW.country
      OR seller_row."stripeAccountId" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy seller account authorization snapshot mismatch';
    END IF;
    IF NEW.status <> 'NOT_SENT'
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerAccountId" IS NOT NULL
      OR NEW."providerAccountType" IS NOT NULL
      OR NEW."providerCountry" IS NOT NULL
      OR NEW."providerCapabilities" IS NOT NULL
      OR NEW."providerReturnedMetadata" IS NOT NULL
      OR NEW."providerDetailsSubmitted" IS NOT NULL
      OR NEW."providerChargesEnabled" IS NOT NULL
      OR NEW."providerPayoutsEnabled" IS NOT NULL
      OR NEW."failureReason" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy seller account command must begin as pristine NOT_SENT evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF TO_JSONB(NEW) - ARRAY[
      'status', 'dispatchStartedAt', 'providerAccountId', 'providerAccountType',
      'providerCountry', 'providerCapabilities', 'providerReturnedMetadata',
      'providerDetailsSubmitted', 'providerChargesEnabled', 'providerPayoutsEnabled',
      'failureReason', 'completedAt', 'updatedAt'
    ] IS DISTINCT FROM TO_JSONB(OLD) - ARRAY[
      'status', 'dispatchStartedAt', 'providerAccountId', 'providerAccountType',
      'providerCountry', 'providerCapabilities', 'providerReturnedMetadata',
      'providerDetailsSubmitted', 'providerChargesEnabled', 'providerPayoutsEnabled',
      'failureReason', 'completedAt', 'updatedAt'
    ] THEN
    RAISE EXCEPTION 'Legacy seller account authorization evidence is immutable';
  END IF;

  has_provider_evidence := NEW."providerAccountId" IS NOT NULL
    OR NEW."providerAccountType" IS NOT NULL OR NEW."providerCountry" IS NOT NULL
    OR NEW."providerCapabilities" IS NOT NULL OR NEW."providerReturnedMetadata" IS NOT NULL
    OR NEW."providerDetailsSubmitted" IS NOT NULL OR NEW."providerChargesEnabled" IS NOT NULL
    OR NEW."providerPayoutsEnabled" IS NOT NULL;
  has_complete_provider_evidence := LENGTH(BTRIM(COALESCE(NEW."providerAccountId", ''))) > 0
    AND LENGTH(BTRIM(COALESCE(NEW."providerAccountType", ''))) > 0
    AND NEW."providerCountry" ~ '^[A-Z]{2}$'
    AND NEW."providerCapabilities" IS NOT NULL AND NEW."providerReturnedMetadata" IS NOT NULL
    AND NEW."providerDetailsSubmitted" IS NOT NULL AND NEW."providerChargesEnabled" IS NOT NULL
    AND NEW."providerPayoutsEnabled" IS NOT NULL;

  IF OLD.status = 'NOT_SENT' AND NEW.status = 'ATTEMPTING' THEN
    IF NEW."dispatchStartedAt" IS NULL OR has_provider_evidence
      OR NEW."failureReason" IS NOT NULL OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid legacy seller account claim';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status IN ('FAILED', 'RECONCILIATION_REQUIRED') THEN
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR LENGTH(BTRIM(COALESCE(NEW."failureReason", ''))) = 0
      OR NEW."completedAt" IS NULL
      OR (NEW.status = 'FAILED' AND has_provider_evidence)
      OR (has_provider_evidence AND NOT has_complete_provider_evidence) THEN
      RAISE EXCEPTION 'Invalid legacy seller account terminal evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO user_row FROM "User" WHERE id = NEW."userId";
    SELECT * INTO seller_row FROM "Seller" WHERE id = NEW."sellerId";
    IF NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR NOT has_complete_provider_evidence
      OR NEW."providerAccountType" IS DISTINCT FROM LOWER(NEW."accountType")
      OR NEW."providerCountry" IS DISTINCT FROM NEW.country
      OR NEW."providerReturnedMetadata" IS DISTINCT FROM NEW."providerMetadata"
      OR NOT (NEW."providerCapabilities" ? 'transfers')
      OR JSONB_TYPEOF(NEW."providerCapabilities" -> 'transfers') IS DISTINCT FROM 'string'
      OR NEW."failureReason" IS NOT NULL OR NEW."completedAt" IS NULL
      OR user_row."sellerId" IS DISTINCT FROM NEW."sellerId"
      OR seller_row."stripeAccountId" IS DISTINCT FROM NEW."providerAccountId" THEN
      RAISE EXCEPTION 'Invalid legacy seller account success evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid legacy seller account state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacySellerAccountCommand_history"
BEFORE INSERT OR UPDATE OR DELETE ON "LegacySellerAccountCommand"
FOR EACH ROW EXECUTE FUNCTION protect_legacy_seller_account_command();

CREATE FUNCTION protect_command_owned_seller_account_projection()
RETURNS trigger AS $$
DECLARE
  command_row "LegacySellerAccountCommand"%ROWTYPE;
BEGIN
  IF NEW."stripeAccountId" IS NOT DISTINCT FROM OLD."stripeAccountId" THEN
    RETURN NEW;
  END IF;
  SELECT * INTO command_row FROM "LegacySellerAccountCommand" WHERE "sellerId" = OLD.id;
  IF command_row.id IS NULL OR OLD."stripeAccountId" IS NOT NULL
    OR NEW."stripeAccountId" IS NULL OR command_row.status <> 'ATTEMPTING' THEN
    RAISE EXCEPTION 'Seller account projection is not owned by an attempting command';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Seller_account_command_projection"
BEFORE UPDATE OF "stripeAccountId" ON "Seller"
FOR EACH ROW EXECUTE FUNCTION protect_command_owned_seller_account_projection();

CREATE FUNCTION protect_command_owned_seller_user_binding()
RETURNS trigger AS $$
BEGIN
  IF NEW."sellerId" IS DISTINCT FROM OLD."sellerId"
    AND EXISTS (SELECT 1 FROM "LegacySellerAccountCommand" WHERE "userId" = OLD.id) THEN
    RAISE EXCEPTION 'Seller account command user binding is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_seller_account_command_binding"
BEFORE UPDATE OF "sellerId" ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_command_owned_seller_user_binding();

CREATE FUNCTION validate_command_owned_seller_account_projection()
RETURNS trigger AS $$
DECLARE
  command_row "LegacySellerAccountCommand"%ROWTYPE;
  seller_account_id TEXT;
  user_seller_id TEXT;
BEGIN
  SELECT * INTO command_row FROM "LegacySellerAccountCommand" WHERE "sellerId" = NEW."sellerId";
  IF command_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT "stripeAccountId" INTO seller_account_id FROM "Seller" WHERE id = NEW."sellerId";
  SELECT "sellerId" INTO user_seller_id FROM "User" WHERE id = NEW."userId";
  IF command_row.status = 'SUCCEEDED' THEN
    IF seller_account_id IS DISTINCT FROM command_row."providerAccountId"
      OR user_seller_id IS DISTINCT FROM command_row."sellerId" THEN
      RAISE EXCEPTION 'Successful seller account command projection is incomplete';
    END IF;
  ELSIF seller_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unfinished seller account command cannot own a provider projection';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "LegacySellerAccountCommand_projection_commit"
AFTER INSERT OR UPDATE ON "LegacySellerAccountCommand"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_command_owned_seller_account_projection();

CREATE FUNCTION validate_seller_account_command_projection()
RETURNS trigger AS $$
DECLARE
  command_row "LegacySellerAccountCommand"%ROWTYPE;
BEGIN
  SELECT * INTO command_row FROM "LegacySellerAccountCommand" WHERE "sellerId" = NEW.id;
  IF command_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW."stripeAccountId" IS NULL OR command_row.status <> 'SUCCEEDED'
    OR command_row."providerAccountId" IS DISTINCT FROM NEW."stripeAccountId" THEN
    RAISE EXCEPTION 'Seller provider projection is not backed by successful command evidence';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Seller_account_command_projection_commit"
AFTER UPDATE OF "stripeAccountId" ON "Seller"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_seller_account_command_projection();

CREATE FUNCTION prevent_legacy_seller_account_command_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy seller account command evidence cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegacySellerAccountCommand_no_truncate"
BEFORE TRUNCATE ON "LegacySellerAccountCommand"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_legacy_seller_account_command_truncate();

COMMIT;
