-- Quarantine legacy rows whose persisted lifecycle evidence cannot be trusted.
-- Preserve provider, attempt, first-attempt, and delivered-at evidence for
-- operator review; never reinterpret an ambiguous row as delivered.
BEGIN;

LOCK TABLE "TransferProofDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "TransferProofDeliveryIntent"
SET
  status = 'RECONCILIATION_REQUIRED',
  "processingAt" = NULL,
  "leaseExpiresAt" = NULL,
  "claimToken" = NULL,
  "dispatchStartedAt" = NULL,
  "lastError" = LEFT(
    'Lifecycle migration quarantined incoherent legacy row from status '
      || status
      || CASE
        WHEN "lastError" IS NULL OR BTRIM("lastError") = '' THEN ''
        ELSE ': ' || "lastError"
      END,
    2000
  )
WHERE (
  (
    status = 'PENDING'
    AND provider IS NULL
    AND "attemptCount" = 0
    AND "firstAttemptAt" IS NULL
    AND "processingAt" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "claimToken" IS NULL
    AND "dispatchStartedAt" IS NULL
    AND "deliveredAt" IS NULL
    AND "lastError" IS NULL
  )
  OR (
    status = 'FAILED'
    AND provider IN ('RESEND', 'SENDGRID')
    AND "attemptCount" BETWEEN 1 AND 2
    AND "firstAttemptAt" IS NOT NULL
    AND "processingAt" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "claimToken" IS NULL
    AND "dispatchStartedAt" IS NULL
    AND "deliveredAt" IS NULL
    AND "lastError" IS NOT NULL
  )
  OR (
    status = 'PROCESSING'
    AND provider IN ('RESEND', 'SENDGRID')
    AND "attemptCount" BETWEEN 0 AND 3
    AND "processingAt" IS NOT NULL
    AND "leaseExpiresAt" IS NOT NULL
    AND "processingAt" <= "leaseExpiresAt"
    AND "claimToken" IS NOT NULL
    AND BTRIM("claimToken") <> ''
    AND "deliveredAt" IS NULL
    AND (
      (
        "attemptCount" = 0
        AND "firstAttemptAt" IS NULL
        AND "dispatchStartedAt" IS NULL
      )
      OR (
        "attemptCount" BETWEEN 1 AND 3
        AND "firstAttemptAt" IS NOT NULL
        AND (
          "dispatchStartedAt" IS NULL
          OR (
            "firstAttemptAt" <= "dispatchStartedAt"
            AND "processingAt" <= "dispatchStartedAt"
            AND "dispatchStartedAt" <= "leaseExpiresAt"
          )
        )
      )
    )
  )
  OR (
    status = 'DELIVERED'
    AND provider IN ('RESEND', 'SENDGRID')
    AND "attemptCount" BETWEEN 1 AND 3
    AND "firstAttemptAt" IS NOT NULL
    AND "processingAt" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "claimToken" IS NULL
    AND "dispatchStartedAt" IS NULL
    AND "deliveredAt" IS NOT NULL
    AND "firstAttemptAt" <= "deliveredAt"
    AND "lastError" IS NULL
  )
  OR (
    status = 'RECONCILIATION_REQUIRED'
    AND "processingAt" IS NULL
    AND "leaseExpiresAt" IS NULL
    AND "claimToken" IS NULL
    AND "dispatchStartedAt" IS NULL
    AND "lastError" IS NOT NULL
  )
) IS NOT TRUE;

CREATE OR REPLACE FUNCTION enforce_transfer_proof_delivery_lifecycle()
RETURNS trigger AS $$
BEGIN
  IF (
    (
      NEW.status = 'PENDING'
      AND NEW.provider IS NULL
      AND NEW."attemptCount" = 0
      AND NEW."firstAttemptAt" IS NULL
      AND NEW."processingAt" IS NULL
      AND NEW."leaseExpiresAt" IS NULL
      AND NEW."claimToken" IS NULL
      AND NEW."dispatchStartedAt" IS NULL
      AND NEW."deliveredAt" IS NULL
      AND NEW."lastError" IS NULL
    )
    OR (
      NEW.status = 'FAILED'
      AND NEW.provider IN ('RESEND', 'SENDGRID')
      AND NEW."attemptCount" BETWEEN 1 AND 2
      AND NEW."firstAttemptAt" IS NOT NULL
      AND NEW."processingAt" IS NULL
      AND NEW."leaseExpiresAt" IS NULL
      AND NEW."claimToken" IS NULL
      AND NEW."dispatchStartedAt" IS NULL
      AND NEW."deliveredAt" IS NULL
      AND NEW."lastError" IS NOT NULL
    )
    OR (
      NEW.status = 'PROCESSING'
      AND NEW.provider IN ('RESEND', 'SENDGRID')
      AND NEW."attemptCount" BETWEEN 0 AND 3
      AND NEW."processingAt" IS NOT NULL
      AND NEW."leaseExpiresAt" IS NOT NULL
      AND NEW."processingAt" <= NEW."leaseExpiresAt"
      AND NEW."claimToken" IS NOT NULL
      AND BTRIM(NEW."claimToken") <> ''
      AND NEW."deliveredAt" IS NULL
      AND (
        (
          NEW."attemptCount" = 0
          AND NEW."firstAttemptAt" IS NULL
          AND NEW."dispatchStartedAt" IS NULL
        )
        OR (
          NEW."attemptCount" BETWEEN 1 AND 3
          AND NEW."firstAttemptAt" IS NOT NULL
          AND (
            NEW."dispatchStartedAt" IS NULL
            OR (
              NEW."firstAttemptAt" <= NEW."dispatchStartedAt"
              AND NEW."processingAt" <= NEW."dispatchStartedAt"
              AND NEW."dispatchStartedAt" <= NEW."leaseExpiresAt"
            )
          )
        )
      )
    )
    OR (
      NEW.status = 'DELIVERED'
      AND NEW.provider IN ('RESEND', 'SENDGRID')
      AND NEW."attemptCount" BETWEEN 1 AND 3
      AND NEW."firstAttemptAt" IS NOT NULL
      AND NEW."processingAt" IS NULL
      AND NEW."leaseExpiresAt" IS NULL
      AND NEW."claimToken" IS NULL
      AND NEW."dispatchStartedAt" IS NULL
      AND NEW."deliveredAt" IS NOT NULL
      AND NEW."firstAttemptAt" <= NEW."deliveredAt"
      AND NEW."lastError" IS NULL
    )
    OR (
      NEW.status = 'RECONCILIATION_REQUIRED'
      AND NEW."processingAt" IS NULL
      AND NEW."leaseExpiresAt" IS NULL
      AND NEW."claimToken" IS NULL
      AND NEW."dispatchStartedAt" IS NULL
      AND NEW."lastError" IS NOT NULL
    )
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid transfer-proof delivery lifecycle state';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_lifecycle_state"
BEFORE INSERT OR UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_delivery_lifecycle();

COMMIT;
