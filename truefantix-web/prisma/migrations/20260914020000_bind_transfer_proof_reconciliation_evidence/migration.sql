-- A reconciliation terminal must preserve the durable evidence accumulated by
-- its source state. Quarantine may explain the ambiguity and, immediately
-- after a dispatch, retain the worker's deterministic retry boundary, but it
-- must not fabricate provider, attempt, or delivery evidence while becoming
-- immutable.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_reconciliation_evidence_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PROCESSING', 'FAILED')
    AND NEW.status = 'RECONCILIATION_REQUIRED' THEN
    IF ROW(
      NEW.provider, NEW."attemptCount", NEW."firstAttemptAt", NEW."deliveredAt"
    ) IS DISTINCT FROM ROW(
      OLD.provider, OLD."attemptCount", OLD."firstAttemptAt", OLD."deliveredAt"
    ) THEN
      RAISE EXCEPTION 'Transfer-proof reconciliation must preserve source attempt evidence';
    END IF;

    IF OLD.status = 'FAILED'
      AND NEW."availableAt" IS DISTINCT FROM OLD."availableAt" THEN
      RAISE EXCEPTION 'Transfer-proof reconciliation must preserve failed retry evidence';
    END IF;

    IF OLD.status = 'PROCESSING'
      AND NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
      AND NOT (
        OLD."dispatchStartedAt" IS NOT NULL
        AND NEW."availableAt" IS NOT DISTINCT FROM (
          CASE
            WHEN OLD."attemptCount" = 1
              THEN OLD."dispatchStartedAt" + INTERVAL '5 minutes'
            WHEN OLD."attemptCount" = 2
              THEN OLD."dispatchStartedAt" + INTERVAL '10 minutes'
            WHEN OLD."attemptCount" >= 3
              THEN OLD."dispatchStartedAt"
            ELSE NULL
          END
        )
      ) THEN
      RAISE EXCEPTION 'Transfer-proof reconciliation requires its source delivery schedule';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_reconciliation_evidence_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_reconciliation_evidence_transition();
