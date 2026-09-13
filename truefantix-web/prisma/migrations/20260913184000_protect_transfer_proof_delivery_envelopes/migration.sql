-- Preserve every legacy provider idempotency key. Existing rows are explicitly
-- version 1; newly staged rows use version 2 with a full-envelope digest.
ALTER TABLE "TransferProofDeliveryIntent"
ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "envelopeDigest" TEXT;

ALTER TABLE "TransferProofDeliveryIntent"
ALTER COLUMN "identityVersion" SET DEFAULT 2;

ALTER TABLE "TransferProofDeliveryIntent"
ADD CONSTRAINT "TransferProofDeliveryIntent_envelope_identity_check" CHECK (
  ("identityVersion" = 1 AND "envelopeDigest" IS NULL)
  OR ("identityVersion" = 2 AND "envelopeDigest" ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION require_current_transfer_proof_delivery_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."identityVersion" <> 2 OR NEW."envelopeDigest" IS NULL THEN
    RAISE EXCEPTION 'New transfer-proof delivery intents require current envelope identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_current_identity_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION require_current_transfer_proof_delivery_identity();

CREATE OR REPLACE FUNCTION protect_transfer_proof_delivery_envelope()
RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW."orderId", NEW.kind, NEW.recipient, NEW."payloadJson",
    NEW."idempotencyKey", NEW."identityVersion", NEW."envelopeDigest", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."orderId", OLD.kind, OLD.recipient, OLD."payloadJson",
    OLD."idempotencyKey", OLD."identityVersion", OLD."envelopeDigest", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery envelope is immutable';
  END IF;

  IF OLD.provider IS NOT NULL AND NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'Transfer-proof delivery provider identity is immutable once pinned';
  END IF;

  IF OLD."firstAttemptAt" IS NOT NULL
    AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt" THEN
    RAISE EXCEPTION 'Transfer-proof first-attempt evidence is immutable once recorded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_immutable_envelope"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_delivery_envelope();
