CREATE TABLE "SpotifyCatalogRequestDeliveryIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "htmlBody" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "envelopeDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "firstAttemptAt" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "dispatchStartedAt" TIMESTAMP(3),
  "providerResult" TEXT,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED')),
  CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_provider_check"
    CHECK ("provider" IS NULL OR "provider" IN ('RESEND', 'SENDGRID')),
  CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_attempt_check"
    CHECK ("attemptCount" BETWEEN 0 AND 1),
  CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_digest_check"
    CHECK ("envelopeDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_idempotency_check"
    CHECK ("idempotencyKey" ~ '^spotify-catalog:[0-9a-f]{64}$')
);

CREATE TABLE "SpotifyCatalogRequestDeliveryItem" (
  "id" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "catalogRequestId" TEXT NOT NULL,
  "requestedValue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SpotifyCatalogRequestDeliveryItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpotifyCatalogRequestDeliveryIntent_idempotencyKey_key"
  ON "SpotifyCatalogRequestDeliveryIntent"("idempotencyKey");
CREATE INDEX "SpotifyCatalogRequestDeliveryIntent_status_availableAt_createdAt_idx"
  ON "SpotifyCatalogRequestDeliveryIntent"("status", "availableAt", "createdAt");
CREATE INDEX "SpotifyCatalogRequestDeliveryIntent_status_leaseExpiresAt_idx"
  ON "SpotifyCatalogRequestDeliveryIntent"("status", "leaseExpiresAt");
CREATE INDEX "SpotifyCatalogRequestDeliveryIntent_userId_createdAt_idx"
  ON "SpotifyCatalogRequestDeliveryIntent"("userId", "createdAt");
CREATE UNIQUE INDEX "SpotifyCatalogRequestDeliveryItem_catalogRequestId_key"
  ON "SpotifyCatalogRequestDeliveryItem"("catalogRequestId");
CREATE UNIQUE INDEX "SpotifyCatalogRequestDeliveryItem_intentId_catalogRequestId_key"
  ON "SpotifyCatalogRequestDeliveryItem"("intentId", "catalogRequestId");
CREATE INDEX "SpotifyCatalogRequestDeliveryItem_intentId_createdAt_idx"
  ON "SpotifyCatalogRequestDeliveryItem"("intentId", "createdAt");

ALTER TABLE "SpotifyCatalogRequestDeliveryIntent"
  ADD CONSTRAINT "SpotifyCatalogRequestDeliveryIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SpotifyCatalogRequestDeliveryItem"
  ADD CONSTRAINT "SpotifyCatalogRequestDeliveryItem_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "SpotifyCatalogRequestDeliveryIntent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SpotifyCatalogRequestDeliveryItem"
  ADD CONSTRAINT "SpotifyCatalogRequestDeliveryItem_catalogRequestId_fkey"
  FOREIGN KEY ("catalogRequestId") REFERENCES "CatalogRequest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION enforce_spotify_catalog_delivery_intent()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING'
      OR NEW.provider IS NOT NULL
      OR NEW."attemptCount" <> 0
      OR NEW."firstAttemptAt" IS NOT NULL
      OR NEW."processingAt" IS NOT NULL
      OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."claimToken" IS NOT NULL
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerResult" IS NOT NULL
      OR NEW."lastError" IS NOT NULL
      OR NEW."deliveredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Spotify catalog delivery must originate as pristine pending evidence';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW.recipient IS DISTINCT FROM OLD.recipient
      OR NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW."textBody" IS DISTINCT FROM OLD."textBody"
      OR NEW."htmlBody" IS DISTINCT FROM OLD."htmlBody"
      OR NEW."payloadJson" IS DISTINCT FROM OLD."payloadJson"
      OR NEW."envelopeDigest" IS DISTINCT FROM OLD."envelopeDigest"
      OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
      OR NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'Spotify catalog delivery identity and envelope are immutable';
    END IF;

    IF OLD.status = 'PENDING' THEN
      IF NEW.status <> 'PROCESSING' OR NEW."attemptCount" <> 0 THEN
        RAISE EXCEPTION 'Spotify catalog delivery pending transition is invalid';
      END IF;
    ELSIF OLD.status = 'PROCESSING' THEN
      IF NEW.status NOT IN ('PROCESSING', 'DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED') THEN
        RAISE EXCEPTION 'Spotify catalog delivery processing transition is invalid';
      ELSIF NEW.status = 'PROCESSING' AND (
        OLD."attemptCount" <> 0
        OR NEW."attemptCount" <> 1
        OR NEW."processingAt" IS DISTINCT FROM OLD."processingAt"
        OR NEW."leaseExpiresAt" IS DISTINCT FROM OLD."leaseExpiresAt"
        OR NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
      ) THEN
        RAISE EXCEPTION 'Spotify catalog delivery dispatch transition is invalid';
      ELSIF NEW.status IN ('DELIVERED', 'FAILED') AND (
        OLD."attemptCount" <> 1
        OR OLD."firstAttemptAt" IS NULL
        OR OLD."dispatchStartedAt" IS NULL
      ) THEN
        RAISE EXCEPTION 'Spotify catalog delivery terminal result requires prior dispatch evidence';
      ELSIF NEW.status = 'RECONCILIATION_REQUIRED' AND (
        NEW."attemptCount" IS DISTINCT FROM OLD."attemptCount"
        OR NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt"
        OR NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      ) THEN
        RAISE EXCEPTION 'Spotify catalog delivery reconciliation must preserve dispatch evidence';
      END IF;
    ELSIF OLD.status IN ('DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED') THEN
      RAISE EXCEPTION 'Spotify catalog delivery terminal evidence is immutable';
    END IF;

    IF OLD.provider IS NOT NULL AND NEW.provider IS DISTINCT FROM OLD.provider THEN
      RAISE EXCEPTION 'Spotify catalog delivery provider is immutable after claim';
    END IF;
    IF OLD."attemptCount" > NEW."attemptCount"
      OR NEW."attemptCount" - OLD."attemptCount" > 1 THEN
      RAISE EXCEPTION 'Spotify catalog delivery attempt evidence is invalid';
    END IF;
    IF OLD."firstAttemptAt" IS NOT NULL
      AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt" THEN
      RAISE EXCEPTION 'Spotify catalog delivery first-attempt time is immutable';
    END IF;
    IF OLD."dispatchStartedAt" IS NOT NULL
      AND NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt" THEN
      RAISE EXCEPTION 'Spotify catalog delivery dispatch evidence is immutable';
    END IF;
    IF OLD."providerResult" IS NOT NULL
      AND NEW."providerResult" IS DISTINCT FROM OLD."providerResult" THEN
      RAISE EXCEPTION 'Spotify catalog delivery provider result is immutable';
    END IF;
    IF OLD."lastError" IS NOT NULL
      AND NEW."lastError" IS DISTINCT FROM OLD."lastError" THEN
      RAISE EXCEPTION 'Spotify catalog delivery failure evidence is immutable';
    END IF;
    IF OLD."deliveredAt" IS NOT NULL
      AND NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" THEN
      RAISE EXCEPTION 'Spotify catalog delivery completion time is immutable';
    END IF;
  END IF;

  IF NEW.status = 'PENDING' THEN
    IF NEW.provider IS NOT NULL
      OR NEW."attemptCount" <> 0
      OR NEW."firstAttemptAt" IS NOT NULL
      OR NEW."processingAt" IS NOT NULL
      OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."claimToken" IS NOT NULL
      OR NEW."dispatchStartedAt" IS NOT NULL
      OR NEW."providerResult" IS NOT NULL
      OR NEW."lastError" IS NOT NULL
      OR NEW."deliveredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Spotify catalog delivery pending evidence is invalid';
    END IF;
  ELSIF NEW.status = 'PROCESSING' THEN
    IF NEW.provider IS NULL
      OR NEW."processingAt" IS NULL
      OR NEW."leaseExpiresAt" IS NULL
      OR NEW."leaseExpiresAt" <= NEW."processingAt"
      OR NEW."claimToken" IS NULL
      OR NEW."providerResult" IS NOT NULL
      OR NEW."lastError" IS NOT NULL
      OR NEW."deliveredAt" IS NOT NULL
      OR (
        NEW."attemptCount" = 0
        AND (NEW."firstAttemptAt" IS NOT NULL OR NEW."dispatchStartedAt" IS NOT NULL)
      )
      OR (
        NEW."attemptCount" = 1
        AND (
          NEW."firstAttemptAt" IS NULL
          OR NEW."dispatchStartedAt" IS NULL
          OR NEW."firstAttemptAt" < NEW."processingAt"
          OR NEW."dispatchStartedAt" <> NEW."firstAttemptAt"
          OR NEW."dispatchStartedAt" >= NEW."leaseExpiresAt"
        )
      ) THEN
      RAISE EXCEPTION 'Spotify catalog delivery processing evidence is invalid';
    END IF;
  ELSIF NEW.status = 'DELIVERED' THEN
    IF NEW.provider IS NULL
      OR NEW."attemptCount" <> 1
      OR NEW."firstAttemptAt" IS NULL
      OR NEW."dispatchStartedAt" IS NULL
      OR NEW."dispatchStartedAt" <> NEW."firstAttemptAt"
      OR NEW."processingAt" IS NOT NULL
      OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."claimToken" IS NOT NULL
      OR NEW."providerResult" IS NULL
      OR NEW."lastError" IS NOT NULL
      OR NEW."deliveredAt" IS NULL
      OR NEW."deliveredAt" < NEW."dispatchStartedAt" THEN
      RAISE EXCEPTION 'Spotify catalog delivery completion evidence is invalid';
    END IF;
  ELSIF NEW.status = 'FAILED' THEN
    IF NEW.provider IS NULL
      OR NEW."attemptCount" <> 1
      OR NEW."firstAttemptAt" IS NULL
      OR NEW."dispatchStartedAt" IS NULL
      OR NEW."dispatchStartedAt" <> NEW."firstAttemptAt"
      OR NEW."processingAt" IS NOT NULL
      OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."claimToken" IS NOT NULL
      OR NEW."providerResult" IS NULL
      OR NEW."lastError" IS NULL
      OR NEW."deliveredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Spotify catalog delivery failure evidence is invalid';
    END IF;
  ELSIF NEW.status = 'RECONCILIATION_REQUIRED' THEN
    IF NEW.provider IS NULL
      OR NEW."processingAt" IS NOT NULL
      OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."claimToken" IS NOT NULL
      OR NEW."lastError" IS NULL
      OR NEW."deliveredAt" IS NOT NULL
      OR (
        NEW."attemptCount" = 0
        AND (
          NEW."firstAttemptAt" IS NOT NULL
          OR NEW."dispatchStartedAt" IS NOT NULL
          OR NEW."providerResult" IS NOT NULL
        )
      )
      OR (
        NEW."attemptCount" = 1
        AND (
          NEW."firstAttemptAt" IS NULL
          OR NEW."dispatchStartedAt" IS NULL
          OR NEW."dispatchStartedAt" <> NEW."firstAttemptAt"
        )
      ) THEN
      RAISE EXCEPTION 'Spotify catalog delivery reconciliation evidence is invalid';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SpotifyCatalogRequestDeliveryIntent_lifecycle"
BEFORE INSERT OR UPDATE ON "SpotifyCatalogRequestDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_spotify_catalog_delivery_intent();

CREATE OR REPLACE FUNCTION protect_spotify_catalog_delivery_history()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Spotify catalog delivery history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SpotifyCatalogRequestDeliveryIntent_delete_guard"
BEFORE DELETE ON "SpotifyCatalogRequestDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION protect_spotify_catalog_delivery_history();
CREATE TRIGGER "SpotifyCatalogRequestDeliveryIntent_truncate_guard"
BEFORE TRUNCATE ON "SpotifyCatalogRequestDeliveryIntent"
FOR EACH STATEMENT EXECUTE FUNCTION protect_spotify_catalog_delivery_history();

CREATE OR REPLACE FUNCTION protect_spotify_catalog_delivery_item()
RETURNS trigger AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status
    FROM "SpotifyCatalogRequestDeliveryIntent"
    WHERE id = NEW."intentId";
    IF parent_status IS DISTINCT FROM 'PENDING' THEN
      RAISE EXCEPTION 'Spotify catalog delivery membership requires a pending parent';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Spotify catalog delivery membership is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SpotifyCatalogRequestDeliveryItem_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SpotifyCatalogRequestDeliveryItem"
FOR EACH ROW EXECUTE FUNCTION protect_spotify_catalog_delivery_item();
CREATE TRIGGER "SpotifyCatalogRequestDeliveryItem_truncate_guard"
BEFORE TRUNCATE ON "SpotifyCatalogRequestDeliveryItem"
FOR EACH STATEMENT EXECUTE FUNCTION protect_spotify_catalog_delivery_history();

CREATE OR REPLACE FUNCTION require_spotify_catalog_delivery_membership(intent_id TEXT)
RETURNS VOID AS $$
DECLARE
  payload JSONB;
  owner_id TEXT;
  request_count INTEGER;
  name_count INTEGER;
  item_count INTEGER;
BEGIN
  SELECT "payloadJson", "userId" INTO payload, owner_id
  FROM "SpotifyCatalogRequestDeliveryIntent"
  WHERE id = intent_id;
  IF payload IS NULL
    OR jsonb_typeof(payload -> 'requestIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(payload -> 'names') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Spotify catalog delivery payload membership is invalid';
  END IF;
  request_count := jsonb_array_length(payload -> 'requestIds');
  name_count := jsonb_array_length(payload -> 'names');
  SELECT count(*) INTO item_count
  FROM "SpotifyCatalogRequestDeliveryItem"
  WHERE "intentId" = intent_id;
  IF request_count < 1 OR request_count > 350
    OR name_count <> request_count
    OR item_count <> request_count
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(payload -> 'requestIds') WITH ORDINALITY request_id(value, position)
      JOIN jsonb_array_elements_text(payload -> 'names') WITH ORDINALITY request_name(value, position)
        USING (position)
      LEFT JOIN "SpotifyCatalogRequestDeliveryItem" item
        ON item."intentId" = intent_id
        AND item."catalogRequestId" = request_id.value
        AND item."requestedValue" = request_name.value
      LEFT JOIN "CatalogRequest" request
        ON request.id = item."catalogRequestId"
        AND request."userId" = owner_id
        AND request."requestedType" = 'ARTIST'
        AND request."requestedValue" = item."requestedValue"
      WHERE item.id IS NULL OR request.id IS NULL
    ) THEN
    RAISE EXCEPTION 'Spotify catalog delivery payload and item membership differ';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_spotify_catalog_request_identity()
RETURNS trigger AS $$
BEGIN
  IF (
    NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."requestedType" IS DISTINCT FROM OLD."requestedType"
    OR NEW."requestedValue" IS DISTINCT FROM OLD."requestedValue"
  ) AND EXISTS (
    SELECT 1
    FROM "SpotifyCatalogRequestDeliveryItem"
    WHERE "catalogRequestId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'Catalog request identity is immutable after Spotify delivery reservation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CatalogRequest_spotify_delivery_identity_guard"
BEFORE UPDATE ON "CatalogRequest"
FOR EACH ROW EXECUTE FUNCTION protect_spotify_catalog_request_identity();

CREATE OR REPLACE FUNCTION check_spotify_catalog_delivery_membership()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'SpotifyCatalogRequestDeliveryIntent' THEN
    PERFORM require_spotify_catalog_delivery_membership(NEW.id);
  ELSE
    PERFORM require_spotify_catalog_delivery_membership(NEW."intentId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "SpotifyCatalogRequestDeliveryIntent_membership_check"
AFTER INSERT ON "SpotifyCatalogRequestDeliveryIntent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_spotify_catalog_delivery_membership();
CREATE CONSTRAINT TRIGGER "SpotifyCatalogRequestDeliveryItem_membership_check"
AFTER INSERT ON "SpotifyCatalogRequestDeliveryItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_spotify_catalog_delivery_membership();
