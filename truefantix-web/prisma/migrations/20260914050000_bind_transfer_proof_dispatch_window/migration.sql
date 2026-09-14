-- A claimed worker may cross the provider boundary only while its exact lease
-- remains live. Resend retries must also dispatch inside the original 24-hour
-- provider-idempotency window, not merely acquire their claim before it closes.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_dispatch_window_transition()
RETURNS trigger AS $$
DECLARE
  dispatch_clock TIMESTAMP(3);
BEGIN
  IF OLD.status = 'PROCESSING'
    AND NEW.status = 'PROCESSING'
    AND NEW."attemptCount" = OLD."attemptCount" + 1 THEN
    dispatch_clock := transfer_proof_delivery_claim_clock(OLD."processingAt");

    IF OLD."leaseExpiresAt" IS NULL
      OR OLD."leaseExpiresAt" <= dispatch_clock
      OR (
        OLD.provider = 'RESEND'
        AND OLD."attemptCount" > 0
        AND (
          OLD."firstAttemptAt" IS NULL
          OR dispatch_clock >= OLD."firstAttemptAt" + INTERVAL '24 hours'
        )
      ) THEN
      RAISE EXCEPTION 'Transfer-proof delivery dispatch requires a live replay-safe worker lease';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_dispatch_window_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_dispatch_window_transition();
