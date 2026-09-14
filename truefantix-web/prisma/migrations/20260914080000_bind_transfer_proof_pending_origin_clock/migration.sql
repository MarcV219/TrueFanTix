-- A newly staged delivery intent is immediately eligible for post-commit
-- dispatch. PostgreSQL owns that initial durable schedule so a caller cannot
-- backdate authorization or defer recovery by supplying an arbitrary clock.
CREATE OR REPLACE FUNCTION transfer_proof_delivery_origin_clock(TIMESTAMP(3))
RETURNS TIMESTAMP(3) AS $$
  SELECT clock_timestamp() AT TIME ZONE 'UTC';
$$ LANGUAGE SQL VOLATILE;

CREATE OR REPLACE FUNCTION protect_transfer_proof_delivery_history_metadata()
RETURNS trigger AS $$
DECLARE
  history_clock TIMESTAMP(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    history_clock := transfer_proof_delivery_origin_clock(NEW."availableAt");
    NEW."availableAt" := history_clock;
    NEW."createdAt" := history_clock;
    NEW."updatedAt" := history_clock;
    RETURN NEW;
  END IF;

  history_clock := transfer_proof_delivery_history_clock();

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
