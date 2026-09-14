-- Durable delivery history must begin with the canonical pending authorization
-- staged by the transfer-proof transaction. A caller must not be able to
-- fabricate provider, attempt, retry, delivery, or reconciliation evidence at
-- row creation and then rely on the append-only guards to preserve it.
CREATE OR REPLACE FUNCTION require_current_transfer_proof_delivery_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."identityVersion" <> 2 OR NEW."envelopeDigest" IS NULL THEN
    RAISE EXCEPTION 'New transfer-proof delivery intents require current envelope identity';
  END IF;

  IF (
    NEW.status = 'PENDING'
    AND NEW.provider IS NULL
    AND NEW."attemptCount" = 0
    AND NEW."firstAttemptAt" IS NULL
    AND NEW."processingAt" IS NULL
    AND NEW."leaseExpiresAt" IS NULL
    AND NEW."claimToken" IS NULL
    AND NEW."dispatchStartedAt" IS NULL
    AND NEW."deliveredAt" IS NULL
    AND NEW."lastError" IS NULL
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'New transfer-proof delivery intents must originate pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
