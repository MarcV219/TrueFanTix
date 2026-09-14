-- Human-review support email is an external side effect and must not escape
-- the Serializable Order transaction that creates the review request. Persist
-- one immutable, provider-idempotent envelope first and dispatch it only after
-- commit through the same bounded lease/reconciliation pattern as accepted
-- transfer-proof delivery.
BEGIN;

CREATE TABLE "TransferProofReviewDeliveryIntent" (
  id TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "htmlBody" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  provider TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstAttemptAt" TIMESTAMP(3),
  "processingAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "dispatchStartedAt" TIMESTAMP(3),
  "providerResult" TEXT,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TransferProofReviewDeliveryIntent_pkey" PRIMARY KEY (id),
  CONSTRAINT "TransferProofReviewDeliveryIntent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "TransferProofReviewDeliveryIntent_status_check"
    CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED', 'DELIVERED', 'RECONCILIATION_REQUIRED')),
  CONSTRAINT "TransferProofReviewDeliveryIntent_provider_check"
    CHECK (provider IS NULL OR provider IN ('RESEND', 'SENDGRID')),
  CONSTRAINT "TransferProofReviewDeliveryIntent_attempt_check"
    CHECK ("attemptCount" BETWEEN 0 AND 3),
  CONSTRAINT "TransferProofReviewDeliveryIntent_identity_check"
    CHECK (
      "requestId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND "idempotencyKey" ~ '^tft-human-review-[0-9a-f]{64}$'
      AND NULLIF(BTRIM(recipient), '') IS NOT NULL
      AND NULLIF(BTRIM(subject), '') IS NOT NULL
      AND NULLIF(BTRIM("textBody"), '') IS NOT NULL
      AND NULLIF(BTRIM("htmlBody"), '') IS NOT NULL
    ),
  CONSTRAINT "TransferProofReviewDeliveryIntent_state_check"
    CHECK (
      (
        status = 'PENDING'
        AND provider IS NULL
        AND "attemptCount" = 0
        AND "firstAttemptAt" IS NULL
        AND "processingAt" IS NULL
        AND "leaseExpiresAt" IS NULL
        AND "claimToken" IS NULL
        AND "dispatchStartedAt" IS NULL
        AND "providerResult" IS NULL
        AND "lastError" IS NULL
        AND "deliveredAt" IS NULL
      )
      OR (
        status = 'PROCESSING'
        AND provider IS NOT NULL
        AND "processingAt" IS NOT NULL
        AND "leaseExpiresAt" IS NOT NULL
        AND "claimToken" IS NOT NULL
        AND "deliveredAt" IS NULL
        AND (
          ("dispatchStartedAt" IS NULL)
          OR ("dispatchStartedAt" IS NOT NULL AND "attemptCount" > 0 AND "firstAttemptAt" IS NOT NULL)
        )
      )
      OR (
        status = 'FAILED'
        AND provider IS NOT NULL
        AND "attemptCount" > 0
        AND "firstAttemptAt" IS NOT NULL
        AND "processingAt" IS NULL
        AND "leaseExpiresAt" IS NULL
        AND "claimToken" IS NULL
        AND "dispatchStartedAt" IS NULL
        AND NULLIF(BTRIM("lastError"), '') IS NOT NULL
        AND "deliveredAt" IS NULL
      )
      OR (
        status = 'DELIVERED'
        AND provider IS NOT NULL
        AND "attemptCount" > 0
        AND "firstAttemptAt" IS NOT NULL
        AND "processingAt" IS NULL
        AND "leaseExpiresAt" IS NULL
        AND "claimToken" IS NULL
        AND "dispatchStartedAt" IS NULL
        AND "lastError" IS NULL
        AND "deliveredAt" IS NOT NULL
      )
      OR (
        status = 'RECONCILIATION_REQUIRED'
        AND "processingAt" IS NULL
        AND "leaseExpiresAt" IS NULL
        AND "claimToken" IS NULL
        AND "dispatchStartedAt" IS NULL
        AND NULLIF(BTRIM("lastError"), '') IS NOT NULL
        AND "deliveredAt" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "TransferProofReviewDeliveryIntent_requestId_key"
ON "TransferProofReviewDeliveryIntent"("requestId");
CREATE UNIQUE INDEX "TransferProofReviewDeliveryIntent_idempotencyKey_key"
ON "TransferProofReviewDeliveryIntent"("idempotencyKey");
CREATE INDEX "TransferProofReviewDeliveryIntent_orderId_createdAt_idx"
ON "TransferProofReviewDeliveryIntent"("orderId", "createdAt");
CREATE INDEX "TransferProofReviewDeliveryIntent_status_availableAt_createdAt_idx"
ON "TransferProofReviewDeliveryIntent"(status, "availableAt", "createdAt");
CREATE INDEX "TransferProofReviewDeliveryIntent_status_leaseExpiresAt_idx"
ON "TransferProofReviewDeliveryIntent"(status, "leaseExpiresAt");

CREATE OR REPLACE FUNCTION require_transfer_proof_review_delivery_subject()
RETURNS trigger AS $$
DECLARE
  parent_order RECORD;
  seller_user_id TEXT;
  proof_data JSONB;
  expected_requested_at TEXT;
  expected_key TEXT;
  database_now TIMESTAMP(3);
BEGIN
  database_now := statement_timestamp() AT TIME ZONE 'UTC';
  IF NEW.status IS DISTINCT FROM 'PENDING'
    OR NEW.provider IS NOT NULL
    OR NEW."attemptCount" <> 0
    OR NEW."firstAttemptAt" IS NOT NULL
    OR NEW."processingAt" IS NOT NULL
    OR NEW."leaseExpiresAt" IS NOT NULL
    OR NEW."claimToken" IS NOT NULL
    OR NEW."dispatchStartedAt" IS NOT NULL
    OR NEW."providerResult" IS NOT NULL
    OR NEW."lastError" IS NOT NULL
    OR NEW."deliveredAt" IS NOT NULL
    OR NEW."availableAt" IS DISTINCT FROM NEW."requestedAt"
    OR NEW."requestedAt" < database_now - INTERVAL '5 seconds'
    OR NEW."requestedAt" > database_now THEN
    RAISE EXCEPTION 'New transfer-proof review delivery intents must originate pending';
  END IF;

  SELECT
    parent_order_row.status::text AS order_status,
    parent_order_row."buyerConfirmationStatus" AS buyer_confirmation_status,
    parent_order_row."transferVerificationStatus" AS transfer_verification_status,
    parent_order_row."disputeWindowEndsAt" AS dispute_window_ends_at,
    parent_order_row."transferProofData" AS transfer_proof_data,
    parent_order_row."sellerId" AS seller_id
  INTO parent_order
  FROM "Order" parent_order_row
  WHERE parent_order_row.id = NEW."orderId"
  FOR UPDATE;

  IF NOT FOUND OR (
    parent_order.order_status = 'PAID'
    AND parent_order.buyer_confirmation_status = 'PENDING'
    AND parent_order.transfer_verification_status = 'MANUAL_REVIEW'
    AND parent_order.dispute_window_ends_at IS NULL
    AND NULLIF(BTRIM(parent_order.transfer_proof_data), '') IS NOT NULL
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Transfer-proof review delivery requires a pending manual-review order';
  END IF;

  BEGIN
    proof_data := parent_order.transfer_proof_data::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Transfer-proof review delivery requires structured proof evidence';
  END;

  SELECT seller_user.id
  INTO seller_user_id
  FROM "User" seller_user
  WHERE seller_user."sellerId" = parent_order.seller_id
  FOR SHARE;

  expected_requested_at := TO_CHAR(
    NEW."requestedAt",
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  expected_key := 'tft-human-review-' || ENCODE(SHA256(CONVERT_TO(
    NEW."orderId" || ':' || NEW."requestId" || ':' || NEW.recipient,
    'UTF8'
  )), 'hex');

  IF JSONB_TYPEOF(proof_data) IS DISTINCT FROM 'object'
    OR proof_data ->> 'manualReviewRequestId' IS DISTINCT FROM NEW."requestId"
    OR proof_data ->> 'manualReviewRequestedAt' IS DISTINCT FROM expected_requested_at
    OR proof_data ->> 'requestedByUserId' IS DISTINCT FROM seller_user_id
    OR NEW.recipient IS DISTINCT FROM 'support@truefantix.com'
    OR NEW."idempotencyKey" IS DISTINCT FROM expected_key THEN
    RAISE EXCEPTION 'Transfer-proof review delivery identity must match the locked review request';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofReviewDeliveryIntent_subject_insert"
BEFORE INSERT ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION require_transfer_proof_review_delivery_subject();

CREATE OR REPLACE FUNCTION protect_transfer_proof_review_delivery_history()
RETURNS trigger AS $$
DECLARE
  database_now TIMESTAMP(3);
  retry_delay INTERVAL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transfer-proof review delivery intents are append-only';
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD."orderId" IS DISTINCT FROM NEW."orderId"
    OR OLD."requestId" IS DISTINCT FROM NEW."requestId"
    OR OLD.recipient IS DISTINCT FROM NEW.recipient
    OR OLD.subject IS DISTINCT FROM NEW.subject
    OR OLD."textBody" IS DISTINCT FROM NEW."textBody"
    OR OLD."htmlBody" IS DISTINCT FROM NEW."htmlBody"
    OR OLD."requestedAt" IS DISTINCT FROM NEW."requestedAt"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Transfer-proof review delivery envelope is immutable';
  END IF;

  IF OLD.status IN ('DELIVERED', 'RECONCILIATION_REQUIRED') THEN
    RAISE EXCEPTION 'Terminal transfer-proof review delivery evidence is immutable';
  END IF;
  IF OLD.provider IS NOT NULL AND OLD.provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION 'Transfer-proof review delivery provider is immutable after claim';
  END IF;
  IF OLD."firstAttemptAt" IS NOT NULL
    AND OLD."firstAttemptAt" IS DISTINCT FROM NEW."firstAttemptAt" THEN
    RAISE EXCEPTION 'Transfer-proof review first-attempt evidence is immutable';
  END IF;

  database_now := statement_timestamp() AT TIME ZONE 'UTC';

  -- Claim acquisition or an expired replay-safe handoff. The application may
  -- read the database clock immediately before this statement, so allow at
  -- most five seconds of transport/queue skew while requiring an exact
  -- fifteen-minute lease from the recorded processing clock.
  IF NEW.status = 'PROCESSING'
    AND NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
    AND NEW."dispatchStartedAt" IS NULL
    AND OLD.status IN ('PENDING', 'FAILED', 'PROCESSING') THEN
    IF NEW.provider NOT IN ('RESEND', 'SENDGRID')
      OR (OLD.provider IS NOT NULL AND NEW.provider IS DISTINCT FROM OLD.provider)
      OR (OLD.status <> 'PENDING' AND OLD.provider IS NULL)
      OR (OLD.status = 'FAILED' AND OLD.provider <> 'RESEND')
      OR NEW."processingAt" < database_now - INTERVAL '5 seconds'
      OR NEW."processingAt" > database_now
      OR NEW."leaseExpiresAt" IS DISTINCT FROM NEW."processingAt" + INTERVAL '15 minutes'
      OR NULLIF(BTRIM(NEW."claimToken"), '') IS NULL
      OR NEW."attemptCount" <> OLD."attemptCount"
      OR NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt"
      OR NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
      OR NEW."providerResult" IS DISTINCT FROM OLD."providerResult"
      OR NEW."lastError" IS NOT NULL
      OR NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt"
      OR (
        OLD.status IN ('PENDING', 'FAILED')
        AND OLD."availableAt" > database_now
      )
      OR (
        OLD.status = 'PROCESSING'
        AND (
          OLD."leaseExpiresAt" > database_now
          OR (
            OLD."dispatchStartedAt" IS NOT NULL
            AND (
              OLD.provider <> 'RESEND'
              OR OLD."firstAttemptAt" IS NULL
              OR OLD."firstAttemptAt" <= database_now - INTERVAL '24 hours'
            )
          )
        )
      ) THEN
      RAISE EXCEPTION 'Invalid transfer-proof review delivery claim acquisition';
    END IF;
    RETURN NEW;
  END IF;

  -- The provider boundary is owned by the live claim and advances exactly one
  -- attempt using the current PostgreSQL clock.
  IF OLD.status = 'PROCESSING' AND NEW.status = 'PROCESSING'
    AND OLD."dispatchStartedAt" IS NULL
    AND NEW."dispatchStartedAt" IS NOT NULL
    AND NEW."claimToken" IS NOT DISTINCT FROM OLD."claimToken" THEN
    IF OLD."leaseExpiresAt" <= database_now
      OR NEW."dispatchStartedAt" < database_now - INTERVAL '5 seconds'
      OR NEW."dispatchStartedAt" > database_now
      OR NEW."attemptCount" <> OLD."attemptCount" + 1
      OR NEW."attemptCount" > 3
      OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW."processingAt" IS DISTINCT FROM OLD."processingAt"
      OR NEW."leaseExpiresAt" IS DISTINCT FROM OLD."leaseExpiresAt"
      OR NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
      OR NEW."providerResult" IS DISTINCT FROM OLD."providerResult"
      OR NEW."lastError" IS DISTINCT FROM OLD."lastError"
      OR NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt"
      OR (
        OLD."firstAttemptAt" IS NULL
        AND (
          NEW."firstAttemptAt" < database_now - INTERVAL '5 seconds'
          OR NEW."firstAttemptAt" > database_now
        )
      )
      OR (
        OLD."firstAttemptAt" IS NOT NULL
        AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt"
      ) THEN
      RAISE EXCEPTION 'Invalid transfer-proof review delivery dispatch boundary';
    END IF;
    RETURN NEW;
  END IF;

  -- If Resend accepted but durable result persistence failed, keep the exact
  -- dispatch evidence and expire only this claim. A successor may replay the
  -- same provider key while the provider idempotency window is live.
  IF OLD.status = 'PROCESSING' AND NEW.status = 'PROCESSING'
    AND OLD."dispatchStartedAt" IS NOT NULL
    AND NEW."claimToken" IS NOT DISTINCT FROM OLD."claimToken" THEN
    retry_delay := INTERVAL '5 minutes' * POWER(2, OLD."attemptCount" - 1);
    IF OLD.provider <> 'RESEND'
      OR OLD."leaseExpiresAt" <= database_now
      OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW."attemptCount" <> OLD."attemptCount"
      OR NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt"
      OR NEW."processingAt" IS DISTINCT FROM OLD."processingAt"
      OR NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt"
      OR NEW."leaseExpiresAt" < database_now - INTERVAL '5 seconds'
      OR NEW."leaseExpiresAt" > database_now
      OR NEW."availableAt" < database_now + retry_delay - INTERVAL '5 seconds'
      OR NEW."availableAt" > database_now + retry_delay
      OR NULLIF(BTRIM(NEW."providerResult"), '') IS NULL
      OR NULLIF(BTRIM(NEW."lastError"), '') IS NULL
      OR NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" THEN
      RAISE EXCEPTION 'Invalid transfer-proof review accepted-send replay fence';
    END IF;
    RETURN NEW;
  END IF;

  -- Terminal provider outcomes must clear the exact live claim and retain its
  -- attempt/provider identity. Successful completion is database-clock bound;
  -- only rejected Resend attempts may enter the deterministic retry schedule.
  IF OLD.status = 'PROCESSING'
    AND NEW.status IN ('FAILED', 'DELIVERED', 'RECONCILIATION_REQUIRED') THEN
    IF NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW."attemptCount" <> OLD."attemptCount"
      OR NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt"
      OR NEW."processingAt" IS NOT NULL
      OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."claimToken" IS NOT NULL
      OR NEW."dispatchStartedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid transfer-proof review delivery result ownership';
    END IF;

    IF NEW.status = 'DELIVERED' THEN
      IF OLD."dispatchStartedAt" IS NULL
        OR OLD."leaseExpiresAt" <= database_now
        OR NEW."deliveredAt" < database_now - INTERVAL '5 seconds'
        OR NEW."deliveredAt" > database_now
        OR NULLIF(BTRIM(NEW."providerResult"), '') IS NULL
        OR NEW."lastError" IS NOT NULL
        OR NEW."availableAt" IS DISTINCT FROM OLD."availableAt" THEN
        RAISE EXCEPTION 'Invalid transfer-proof review delivery completion evidence';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW."deliveredAt" IS NOT NULL OR NULLIF(BTRIM(NEW."lastError"), '') IS NULL THEN
      RAISE EXCEPTION 'Invalid transfer-proof review delivery failure evidence';
    END IF;

    IF NEW.status = 'FAILED' THEN
      retry_delay := INTERVAL '5 minutes' * POWER(2, OLD."attemptCount" - 1);
      IF OLD.provider <> 'RESEND'
        OR OLD."dispatchStartedAt" IS NULL
        OR OLD."leaseExpiresAt" <= database_now
        OR OLD."attemptCount" >= 3
        OR NEW."availableAt" < database_now + retry_delay - INTERVAL '5 seconds'
        OR NEW."availableAt" > database_now + retry_delay THEN
        RAISE EXCEPTION 'Invalid transfer-proof review delivery retry schedule';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD."leaseExpiresAt" > database_now THEN
      retry_delay := INTERVAL '5 minutes' * POWER(2, GREATEST(OLD."attemptCount" - 1, 0));
      IF (
        OLD."attemptCount" < 3
        AND NEW."availableAt" >= database_now + retry_delay - INTERVAL '5 seconds'
        AND NEW."availableAt" <= database_now + retry_delay
      ) IS NOT TRUE AND (
        OLD."attemptCount" >= 3
        AND NEW."availableAt" >= database_now - INTERVAL '5 seconds'
        AND NEW."availableAt" <= database_now
      ) IS NOT TRUE THEN
        RAISE EXCEPTION 'Invalid transfer-proof review reconciliation schedule';
      END IF;
    ELSIF NEW."availableAt" IS DISTINCT FROM OLD."availableAt" THEN
      RAISE EXCEPTION 'Invalid transfer-proof review reconciliation evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'FAILED' AND NEW.status = 'RECONCILIATION_REQUIRED' THEN
    IF OLD."attemptCount" < 3
      OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW."attemptCount" <> OLD."attemptCount"
      OR NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt"
      OR NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
      OR NEW."providerResult" IS DISTINCT FROM OLD."providerResult"
      OR NEW."lastError" IS DISTINCT FROM OLD."lastError"
      OR NEW."deliveredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid exhausted transfer-proof review delivery evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid transfer-proof review delivery transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofReviewDeliveryIntent_history_update"
BEFORE UPDATE ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_review_delivery_history();

CREATE TRIGGER "TransferProofReviewDeliveryIntent_history_delete"
BEFORE DELETE ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_review_delivery_history();

CREATE OR REPLACE FUNCTION block_transfer_proof_review_delivery_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Transfer-proof review delivery intents are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofReviewDeliveryIntent_history_truncate"
BEFORE TRUNCATE ON "TransferProofReviewDeliveryIntent"
FOR EACH STATEMENT EXECUTE FUNCTION block_transfer_proof_review_delivery_truncate();

COMMIT;
