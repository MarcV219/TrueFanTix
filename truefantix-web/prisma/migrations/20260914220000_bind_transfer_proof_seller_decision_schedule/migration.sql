-- A seller-decision intent must become eligible at the exact authenticated
-- decision clock. Retry scheduling remains governed by the existing update
-- transition guards after the first provider attempt.
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
    RAISE EXCEPTION 'Existing seller review-decision schedule is not canonical';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION require_transfer_proof_seller_decision_schedule()
RETURNS trigger AS $$
BEGIN
  IF NEW."payloadJson" ->> 'decidedAt'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR NEW."availableAt" IS DISTINCT FROM
      (NEW."payloadJson" ->> 'decidedAt')::timestamptz AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'Seller review-decision initial schedule must match its decision clock';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_seller_decision_schedule_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW
WHEN (NEW.kind = 'SELLER_REVIEW_DECISION_EMAIL')
EXECUTE FUNCTION require_transfer_proof_seller_decision_schedule();

COMMIT;
