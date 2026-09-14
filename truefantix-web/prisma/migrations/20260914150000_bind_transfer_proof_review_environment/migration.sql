-- The envelope-bound application origin introduced by migration 95 was still
-- selected by the row writer from a shared cross-environment allowlist. Bind
-- it to PostgreSQL's own database identity so isolated staging cannot persist
-- a production or localhost review link under an otherwise valid digest.
BEGIN;

LOCK TABLE "TransferProofReviewDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION canonical_transfer_proof_review_origin_for_database(
  database_name TEXT
)
RETURNS TEXT AS $$
BEGIN
  IF database_name = 'primary_preview' THEN
    RETURN 'https://truefantix-staging-preview.vercel.app';
  END IF;
  IF database_name = 'primary_ticketing_test'
    OR database_name ~ '^truefantix_primary_test_[0-9]{8}(_[0-9]{1,10})?$' THEN
    RETURN 'http://localhost:3000';
  END IF;
  RAISE EXCEPTION 'Unrecognized transfer-proof review database environment: %', database_name;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION canonical_transfer_proof_review_origin()
RETURNS TEXT AS $$
  SELECT canonical_transfer_proof_review_origin_for_database(current_database());
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  expected_origin TEXT;
BEGIN
  -- Resolve unconditionally so an empty outbox cannot let an unknown database
  -- install this environment authorization and fail only on its first request.
  expected_origin := canonical_transfer_proof_review_origin();
  IF EXISTS (
    SELECT 1
    FROM "TransferProofReviewDeliveryIntent"
    WHERE "payloadJson" ->> 'appOrigin' IS DISTINCT FROM expected_origin
  ) THEN
    RAISE EXCEPTION 'Transfer-proof review origin preflight found cross-environment history';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION require_transfer_proof_review_delivery_environment()
RETURNS trigger AS $$
BEGIN
  IF NEW."payloadJson" ->> 'appOrigin'
    IS DISTINCT FROM canonical_transfer_proof_review_origin() THEN
    RAISE EXCEPTION 'Transfer-proof review delivery origin does not match the database environment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofReviewDeliveryIntent_environment_insert"
BEFORE INSERT ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION require_transfer_proof_review_delivery_environment();

COMMIT;
