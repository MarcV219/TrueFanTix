-- Keep the already-deployed transition migrations immutable. Tighten only
-- future first dispatches so the durable first-attempt timestamp identifies
-- the exact provider boundary rather than an earlier arbitrary instant.
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
