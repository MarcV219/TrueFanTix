-- A claim consumes the durable schedule established by its source row. It may
-- record when processing actually began, but it must not rewrite the initial
-- delivery or retry boundary while acquiring ownership.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_claim_schedule_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PENDING', 'FAILED')
    AND NEW.status = 'PROCESSING'
    AND NEW."availableAt" IS DISTINCT FROM OLD."availableAt" THEN
    RAISE EXCEPTION 'Transfer-proof delivery claim must preserve its source schedule';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_claim_schedule_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_claim_schedule_transition();
