-- The generic delivery metadata trigger runs before the seller-decision
-- schedule trigger and previously replaced its authenticated decision clock
-- with clock_timestamp(). Preserve PostgreSQL-owned creation history while
-- leaving the initial seller-decision schedule for the later exact-envelope
-- trigger to authorize.
BEGIN;

LOCK TABLE "TransferProofDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TransferProofDeliveryIntent"
    WHERE kind = 'SELLER_REVIEW_DECISION_EMAIL'
      AND status = 'PENDING'
      AND "attemptCount" = 0
      AND (
        "payloadJson" ->> 'decidedAt'
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        OR "availableAt" IS DISTINCT FROM
          ("payloadJson" ->> 'decidedAt')::timestamptz AT TIME ZONE 'UTC'
      )
  ) THEN
    RAISE EXCEPTION 'Existing seller review-decision origin schedule is not canonical';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION protect_transfer_proof_delivery_history_metadata()
RETURNS trigger AS $$
DECLARE
  history_clock TIMESTAMP(3);
  decision_clock_text TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'SELLER_REVIEW_DECISION_EMAIL' THEN
      decision_clock_text := NEW."payloadJson" ->> 'decidedAt';
      IF decision_clock_text IS NULL
        OR decision_clock_text
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
        RAISE EXCEPTION 'Seller review-decision initial schedule requires an exact decision clock';
      END IF;
      history_clock := transfer_proof_delivery_history_clock();
    ELSE
      history_clock := transfer_proof_delivery_origin_clock(NEW."availableAt");
      NEW."availableAt" := history_clock;
    END IF;
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

COMMIT;
