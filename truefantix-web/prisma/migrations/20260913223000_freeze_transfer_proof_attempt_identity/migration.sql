-- Replay eligibility depends on the provider and first-attempt timestamp that
-- were recorded for the first external dispatch. Once an attempt exists,
-- neither value may be rewritten by a standalone update or a claim handoff.
CREATE OR REPLACE FUNCTION freeze_transfer_proof_attempt_identity()
RETURNS trigger AS $$
BEGIN
  IF OLD."attemptCount" > 0
    AND NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'Transfer-proof delivery attempted provider identity is immutable';
  END IF;

  IF OLD."attemptCount" > 0
    AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt" THEN
    RAISE EXCEPTION 'Transfer-proof delivery attempted first-attempt identity is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_freeze_attempt_identity"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION freeze_transfer_proof_attempt_identity();
