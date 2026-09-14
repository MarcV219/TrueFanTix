-- A provider result may advance durable delivery or retry evidence only while
-- the worker still owns a live lease at PostgreSQL's timezone-independent
-- statement clock. Reconciliation remains available after lease expiry so an
-- ambiguous stale dispatch can still be quarantined without authorizing a
-- retry or claiming successful delivery.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_result_lease_transition()
RETURNS trigger AS $$
DECLARE
  result_clock TIMESTAMP(3);
BEGIN
  IF OLD.status = 'PROCESSING'
    AND OLD."dispatchStartedAt" IS NOT NULL
    AND (
      NEW.status IN ('DELIVERED', 'FAILED')
      OR (
        NEW.status = 'PROCESSING'
        AND NEW."claimToken" IS NOT DISTINCT FROM OLD."claimToken"
        AND NEW."processingAt" IS NOT DISTINCT FROM OLD."processingAt"
        AND NEW."dispatchStartedAt" IS NOT DISTINCT FROM OLD."dispatchStartedAt"
        AND NEW."leaseExpiresAt" IS NOT DISTINCT FROM NEW."processingAt"
        AND NEW."lastError" IS NOT NULL
      )
    ) THEN
    result_clock := transfer_proof_delivery_claim_clock(OLD."processingAt");

    IF OLD."leaseExpiresAt" IS NULL
      OR OLD."leaseExpiresAt" <= result_clock THEN
      RAISE EXCEPTION 'Transfer-proof delivery result requires its live worker lease';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_result_lease_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_result_lease_transition();
