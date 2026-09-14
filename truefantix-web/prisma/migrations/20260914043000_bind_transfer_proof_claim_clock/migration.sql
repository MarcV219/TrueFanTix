-- A newly acquired claim must own a lease that is still live at the database
-- boundary. Historical processing timestamps must not create an immediately
-- expired owner or move a Resend replay back inside its 24-hour safety window.
CREATE OR REPLACE FUNCTION transfer_proof_delivery_claim_clock(TIMESTAMP(3))
RETURNS TIMESTAMP(3) AS $$
  SELECT statement_timestamp() AT TIME ZONE 'UTC';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION enforce_transfer_proof_claim_lease_transition()
RETURNS trigger AS $$
DECLARE
  claim_clock TIMESTAMP(3);
BEGIN
  IF (
      (OLD.status IN ('PENDING', 'FAILED') AND NEW.status = 'PROCESSING')
      OR (
        OLD.status = 'PROCESSING'
        AND NEW.status = 'PROCESSING'
        AND NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
      )
    ) THEN
    claim_clock := transfer_proof_delivery_claim_clock(NEW."processingAt");

    IF NEW."leaseExpiresAt" IS DISTINCT FROM (
        NEW."processingAt" + INTERVAL '15 minutes'
      )
      OR NEW."processingAt" > claim_clock + INTERVAL '30 seconds' THEN
      RAISE EXCEPTION 'Transfer-proof delivery claim requires the bounded worker lease';
    END IF;

    IF NEW."leaseExpiresAt" <= claim_clock
      OR (
        OLD.provider = 'RESEND'
        AND OLD."attemptCount" > 0
        AND (
          OLD."firstAttemptAt" IS NULL
          OR claim_clock >= OLD."firstAttemptAt" + INTERVAL '24 hours'
        )
      ) THEN
      RAISE EXCEPTION 'Transfer-proof delivery claim requires a live replay-safe worker lease';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
