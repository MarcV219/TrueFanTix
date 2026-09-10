-- Payment attempts contain mutable lifecycle state but immutable command, scope,
-- expected-value, and provider-identity evidence. Provider events and exceptions
-- are append-only reconciliation evidence.
CREATE OR REPLACE FUNCTION reject_primary_payment_attempt_evidence_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PrimaryPaymentAttempt rows are append-only';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."organizerId" IS DISTINCT FROM OLD."organizerId"
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."buyerUserId" IS DISTINCT FROM OLD."buyerUserId"
    OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId"
    OR NEW."expectedAmountMinor" IS DISTINCT FROM OLD."expectedAmountMinor"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."createIdempotencyKey" IS DISTINCT FROM OLD."createIdempotencyKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'PrimaryPaymentAttempt command evidence is immutable';
  END IF;

  IF OLD."providerIntentId" IS NOT NULL AND
    (NEW."providerIntentId" IS DISTINCT FROM OLD."providerIntentId"
      OR NEW."providerCreatedAt" IS DISTINCT FROM OLD."providerCreatedAt") THEN
    RAISE EXCEPTION 'PrimaryPaymentAttempt provider identity is immutable after attachment';
  END IF;
  IF OLD."providerIntentId" IS NULL AND NEW."providerIntentId" IS NOT NULL AND NEW."providerCreatedAt" IS NULL THEN
    RAISE EXCEPTION 'PrimaryPaymentAttempt provider attachment requires provider creation time';
  END IF;
  IF OLD."providerIntentId" IS NULL AND NEW."providerIntentId" IS NULL AND NEW."providerCreatedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'PrimaryPaymentAttempt provider creation time requires provider identity';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'PENDING_PROVIDER' AND NEW."status" IN ('PROCESSING', 'RECONCILIATION_REQUIRED')) OR
    (OLD."status" = 'PROCESSING' AND NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) OR
    (OLD."status" IN ('FAILED', 'CANCELLED') AND NEW."status" = 'RECONCILIATION_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'Invalid PrimaryPaymentAttempt state transition: % -> %', OLD."status", NEW."status";
  END IF;

  IF NEW."terminalAt" IS DISTINCT FROM OLD."terminalAt" AND NOT (
    OLD."terminalAt" IS NULL AND NEW."terminalAt" IS NOT NULL AND
    NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'Invalid PrimaryPaymentAttempt terminal metadata change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"
BEFORE UPDATE OR DELETE ON "PrimaryPaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION reject_primary_payment_attempt_evidence_change();

CREATE OR REPLACE FUNCTION reject_primary_payment_append_only_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryPaymentProviderEvent_append_only"
BEFORE UPDATE OR DELETE ON "PrimaryPaymentProviderEvent"
FOR EACH ROW EXECUTE FUNCTION reject_primary_payment_append_only_change();

CREATE TRIGGER "PrimaryPaymentException_append_only"
BEFORE UPDATE OR DELETE ON "PrimaryPaymentException"
FOR EACH ROW EXECUTE FUNCTION reject_primary_payment_append_only_change();
