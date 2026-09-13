-- Preserve every deployed transition migration and require terminal delivery
-- evidence to descend from the currently recorded provider dispatch boundary.
-- A retry claim that has not crossed the provider boundary cannot be promoted
-- directly to DELIVERED, and its completion timestamp cannot predate dispatch.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_delivery_transition()
RETURNS trigger AS $$
BEGIN
  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('PENDING', 'PROCESSING'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN (
      'PROCESSING', 'FAILED', 'DELIVERED', 'RECONCILIATION_REQUIRED'
    ))
    OR (OLD.status = 'FAILED' AND NEW.status IN (
      'FAILED', 'PROCESSING', 'RECONCILIATION_REQUIRED'
    ))
    OR (OLD.status = 'DELIVERED' AND NEW.status = 'DELIVERED')
    OR (
      OLD.status = 'RECONCILIATION_REQUIRED'
      AND NEW.status = 'RECONCILIATION_REQUIRED'
    )
  ) THEN
    RAISE EXCEPTION 'Invalid transfer-proof delivery lifecycle transition';
  END IF;

  IF OLD.status IN ('DELIVERED', 'RECONCILIATION_REQUIRED')
    AND ROW(
      NEW.status, NEW.provider, NEW."attemptCount", NEW."firstAttemptAt",
      NEW."processingAt", NEW."leaseExpiresAt", NEW."claimToken",
      NEW."dispatchStartedAt", NEW."deliveredAt", NEW."lastError",
      NEW."availableAt"
    ) IS DISTINCT FROM ROW(
      OLD.status, OLD.provider, OLD."attemptCount", OLD."firstAttemptAt",
      OLD."processingAt", OLD."leaseExpiresAt", OLD."claimToken",
      OLD."dispatchStartedAt", OLD."deliveredAt", OLD."lastError",
      OLD."availableAt"
    ) THEN
    RAISE EXCEPTION 'Terminal transfer-proof delivery evidence is immutable';
  END IF;

  IF NEW."attemptCount" < OLD."attemptCount"
    OR NEW."attemptCount" > OLD."attemptCount" + 1 THEN
    RAISE EXCEPTION 'Transfer-proof delivery attempt evidence is not monotonic';
  END IF;

  IF OLD.status IN ('PENDING', 'FAILED')
    AND NEW.status = 'PROCESSING'
    AND NOT (
      NEW."attemptCount" = OLD."attemptCount"
      AND NEW."processingAt" >= OLD."availableAt"
      AND NEW."leaseExpiresAt" > NEW."processingAt"
      AND NEW."dispatchStartedAt" IS NULL
      AND NEW."deliveredAt" IS NULL
      AND NEW."lastError" IS NULL
    ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery claim must be due and pre-dispatch';
  END IF;

  IF OLD.status = 'PROCESSING'
    AND NEW.status = 'PROCESSING'
    AND NEW."attemptCount" = OLD."attemptCount"
    AND ROW(
      NEW."processingAt", NEW."leaseExpiresAt", NEW."claimToken",
      NEW."dispatchStartedAt"
    ) IS DISTINCT FROM ROW(
      OLD."processingAt", OLD."leaseExpiresAt", OLD."claimToken",
      OLD."dispatchStartedAt"
    )
    AND NOT (
      (
        NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
        AND NEW."processingAt" >= OLD."leaseExpiresAt"
        AND NEW."leaseExpiresAt" > NEW."processingAt"
        AND NEW."dispatchStartedAt" IS NULL
        AND (
          (
            OLD.provider = 'SENDGRID'
            AND OLD."dispatchStartedAt" IS NULL
          )
          OR (
            OLD.provider = 'RESEND'
            AND (
              (
                OLD."attemptCount" = 0
                AND OLD."dispatchStartedAt" IS NULL
              )
              OR (
                OLD."attemptCount" > 0
                AND OLD."firstAttemptAt" IS NOT NULL
                AND NEW."processingAt" < OLD."firstAttemptAt" + INTERVAL '24 hours'
              )
            )
          )
        )
      )
      OR (
        OLD."dispatchStartedAt" IS NOT NULL
        AND NEW."claimToken" IS NOT DISTINCT FROM OLD."claimToken"
        AND NEW."processingAt" IS NOT DISTINCT FROM OLD."processingAt"
        AND NEW."dispatchStartedAt" IS NOT DISTINCT FROM OLD."dispatchStartedAt"
        AND NEW."leaseExpiresAt" IS NOT DISTINCT FROM NEW."processingAt"
        AND NEW."lastError" IS NOT NULL
      )
    ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery expired claim is not replay-safe';
  END IF;

  IF NEW."attemptCount" = OLD."attemptCount" + 1
    AND NOT (
      OLD.status = 'PROCESSING'
      AND NEW.status = 'PROCESSING'
      AND OLD."dispatchStartedAt" IS NULL
      AND NEW."dispatchStartedAt" IS NOT NULL
      AND NEW.provider IS NOT DISTINCT FROM OLD.provider
      AND NEW."claimToken" IS NOT DISTINCT FROM OLD."claimToken"
      AND NEW."processingAt" IS NOT DISTINCT FROM OLD."processingAt"
      AND NEW."leaseExpiresAt" IS NOT DISTINCT FROM OLD."leaseExpiresAt"
      AND (
        OLD."attemptCount" > 0
        OR NEW."firstAttemptAt" IS NOT DISTINCT FROM NEW."dispatchStartedAt"
      )
    ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery attempt increment requires its owned dispatch boundary';
  END IF;

  IF OLD.status IS DISTINCT FROM 'DELIVERED'
    AND NEW.status = 'DELIVERED'
    AND NOT (
      OLD.status = 'PROCESSING'
      AND OLD."attemptCount" >= 1
      AND OLD."dispatchStartedAt" IS NOT NULL
      AND NEW."attemptCount" = OLD."attemptCount"
      AND NEW."deliveredAt" IS NOT NULL
      AND NEW."deliveredAt" >= OLD."dispatchStartedAt"
    ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery completion requires its owned dispatch boundary';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
