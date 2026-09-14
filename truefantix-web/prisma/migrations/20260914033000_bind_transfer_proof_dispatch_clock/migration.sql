-- The dispatcher records its provider boundary from the same captured clock as
-- the owned claim. A forged later instant must not extend retry, completion, or
-- provider-idempotency evidence within an otherwise valid lease.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_dispatch_clock_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PROCESSING'
    AND NEW.status = 'PROCESSING'
    AND NEW."attemptCount" = OLD."attemptCount" + 1
    AND NEW."dispatchStartedAt" IS DISTINCT FROM OLD."processingAt" THEN
    RAISE EXCEPTION 'Transfer-proof delivery dispatch must use its owned claim clock';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_dispatch_clock_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_dispatch_clock_transition();
