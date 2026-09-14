-- Append-only delivery history must keep the same durable row identity and
-- trustworthy creation/update chronology for its entire lifetime. PostgreSQL,
-- rather than a caller-controlled application clock, owns both timestamps.
CREATE OR REPLACE FUNCTION transfer_proof_delivery_history_clock()
RETURNS TIMESTAMP(3) AS $$
  SELECT clock_timestamp() AT TIME ZONE 'UTC';
$$ LANGUAGE SQL VOLATILE;

CREATE OR REPLACE FUNCTION protect_transfer_proof_delivery_history_metadata()
RETURNS trigger AS $$
DECLARE
  history_clock TIMESTAMP(3);
BEGIN
  history_clock := transfer_proof_delivery_history_clock();

  IF TG_OP = 'INSERT' THEN
    NEW."createdAt" := history_clock;
    NEW."updatedAt" := history_clock;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Transfer-proof delivery row identity is immutable';
  END IF;

  IF NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Transfer-proof delivery creation time is immutable';
  END IF;

  NEW."updatedAt" := GREATEST(
    history_clock,
    OLD."createdAt",
    OLD."updatedAt" + INTERVAL '1 millisecond'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_history_metadata"
BEFORE INSERT OR UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_delivery_history_metadata();
