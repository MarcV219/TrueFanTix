-- Preserve active claim evidence across dispatch and expired-lease handoff.
-- The only PROCESSING-to-PROCESSING update that may rewrite retry metadata is
-- the explicit same-owner Resend recovery path while its retry budget remains.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_processing_evidence_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PROCESSING' AND NEW.status = 'PROCESSING' THEN
    IF NEW."attemptCount" = OLD."attemptCount" + 1 THEN
      IF NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
        OR NEW."lastError" IS DISTINCT FROM OLD."lastError" THEN
        RAISE EXCEPTION 'Transfer-proof delivery dispatch must preserve active claim evidence';
      END IF;
    ELSIF NEW."attemptCount" = OLD."attemptCount" THEN
      IF NEW."claimToken" IS DISTINCT FROM OLD."claimToken" THEN
        IF NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
          OR NEW."lastError" IS NOT NULL THEN
          RAISE EXCEPTION 'Transfer-proof delivery handoff must preserve retry schedule and clear stale errors';
        END IF;
      ELSIF ROW(
        NEW."processingAt", NEW."leaseExpiresAt", NEW."dispatchStartedAt"
      ) IS DISTINCT FROM ROW(
        OLD."processingAt", OLD."leaseExpiresAt", OLD."dispatchStartedAt"
      ) THEN
        IF NOT (
          OLD.provider = 'RESEND'
          AND OLD."attemptCount" BETWEEN 1 AND 2
          AND OLD."dispatchStartedAt" IS NOT NULL
          AND NEW."processingAt" IS NOT DISTINCT FROM OLD."processingAt"
          AND NEW."dispatchStartedAt" IS NOT DISTINCT FROM OLD."dispatchStartedAt"
          AND NEW."leaseExpiresAt" IS NOT DISTINCT FROM NEW."processingAt"
          AND NEW."lastError" IS NOT NULL
          AND NEW."availableAt" > OLD."dispatchStartedAt"
        ) THEN
          RAISE EXCEPTION 'Transfer-proof delivery recovery requires replay-safe Resend evidence';
        END IF;
      ELSIF NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
        OR NEW."lastError" IS DISTINCT FROM OLD."lastError" THEN
        RAISE EXCEPTION 'Active transfer-proof delivery evidence is immutable outside recovery';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_processing_evidence_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_processing_evidence_transition();
