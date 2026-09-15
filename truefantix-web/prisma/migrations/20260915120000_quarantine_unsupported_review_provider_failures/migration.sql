-- Restored review-delivery history can contain a failed attempt whose pinned
-- provider predates the current RESEND/SENDGRID allowlist. The worker already
-- recognizes that evidence as terminal reconciliation work, but migration 94's
-- generic FAILED transition only admitted exhausted attempts. Preserve the
-- complete failed-attempt evidence while allowing this one fail-closed legacy
-- quarantine path.
BEGIN;

CREATE OR REPLACE FUNCTION quarantine_unsupported_transfer_proof_review_provider()
RETURNS trigger AS $$
BEGIN
  IF TO_JSONB(NEW) - ARRAY['status', 'lastError', 'updatedAt']
      IS DISTINCT FROM
      TO_JSONB(OLD) - ARRAY['status', 'lastError', 'updatedAt']
    OR NEW.provider IS NULL
    OR NEW.provider IN ('RESEND', 'SENDGRID')
    OR NEW."lastError" IS DISTINCT FROM (
      'Unsupported recorded review delivery provider '
      || OLD.provider
      || '; reconciliation required'
    ) THEN
    RAISE EXCEPTION 'Invalid unsupported review provider reconciliation evidence';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "TransferProofReviewDeliveryIntent_history_update"
ON "TransferProofReviewDeliveryIntent";

CREATE TRIGGER "TransferProofReviewDeliveryIntent_history_update"
BEFORE UPDATE ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW
WHEN (NOT (
  OLD.status = 'FAILED'
  AND NEW.status = 'RECONCILIATION_REQUIRED'
  AND OLD.provider IS NOT NULL
  AND OLD.provider NOT IN ('RESEND', 'SENDGRID')
))
EXECUTE FUNCTION protect_transfer_proof_review_delivery_history();

CREATE TRIGGER "TransferProofReviewDeliveryIntent_unsupported_provider_update"
BEFORE UPDATE ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW
WHEN (
  OLD.status = 'FAILED'
  AND NEW.status = 'RECONCILIATION_REQUIRED'
  AND OLD.provider IS NOT NULL
  AND OLD.provider NOT IN ('RESEND', 'SENDGRID')
)
EXECUTE FUNCTION quarantine_unsupported_transfer_proof_review_provider();

COMMIT;
