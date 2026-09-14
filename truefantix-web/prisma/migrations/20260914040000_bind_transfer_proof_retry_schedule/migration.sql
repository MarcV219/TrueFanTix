-- Retryable provider rejection and accepted-Resend persistence recovery both
-- use the dispatcher's deterministic exponential schedule. A writer must not
-- accelerate or postpone the next replay after the provider boundary.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_retry_schedule_transition()
RETURNS trigger AS $$
DECLARE
  expected_available_at TIMESTAMP(3);
BEGIN
  IF OLD.status = 'PROCESSING'
    AND OLD."dispatchStartedAt" IS NOT NULL
    AND NEW."attemptCount" = OLD."attemptCount"
    AND (
      NEW.status = 'FAILED'
      OR (
        NEW.status = 'PROCESSING'
        AND NEW."claimToken" IS NOT DISTINCT FROM OLD."claimToken"
        AND NEW."processingAt" IS NOT DISTINCT FROM OLD."processingAt"
        AND NEW."dispatchStartedAt" IS NOT DISTINCT FROM OLD."dispatchStartedAt"
        AND NEW."leaseExpiresAt" IS NOT DISTINCT FROM NEW."processingAt"
        AND NEW."lastError" IS NOT NULL
      )
    ) THEN
    expected_available_at := CASE NEW."attemptCount"
      WHEN 1 THEN OLD."dispatchStartedAt" + INTERVAL '5 minutes'
      WHEN 2 THEN OLD."dispatchStartedAt" + INTERVAL '10 minutes'
      ELSE NULL
    END;

    IF expected_available_at IS NULL
      OR NEW."availableAt" IS DISTINCT FROM expected_available_at THEN
      RAISE EXCEPTION 'Transfer-proof delivery retry requires its deterministic dispatch schedule';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_retry_schedule_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_retry_schedule_transition();
