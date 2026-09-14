-- Claim and expired-lease handoff ownership is bounded to the worker lease
-- implemented by the dispatcher. A forged relative duration or future claim
-- timestamp must not postpone recovery beyond the real acquisition boundary.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_claim_lease_transition()
RETURNS trigger AS $$
BEGIN
  IF (
      (OLD.status IN ('PENDING', 'FAILED') AND NEW.status = 'PROCESSING')
      OR (
        OLD.status = 'PROCESSING'
        AND NEW.status = 'PROCESSING'
        AND NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
      )
    )
    AND (
      NEW."leaseExpiresAt" IS DISTINCT FROM (
        NEW."processingAt" + INTERVAL '15 minutes'
      )
      OR NEW."processingAt" > (
        statement_timestamp() AT TIME ZONE 'UTC'
      ) + INTERVAL '30 seconds'
    ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery claim requires the bounded worker lease';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_claim_lease_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_claim_lease_transition();
