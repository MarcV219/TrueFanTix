CREATE TABLE "PrimaryCancellationRefundLink" (
  "id" TEXT NOT NULL,
  "cancellationId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryCancellationRefundLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrimaryCancellationRefundLink_refundId_key" ON "PrimaryCancellationRefundLink"("refundId");
CREATE UNIQUE INDEX "PrimaryCancellationRefundLink_cancellationId_refundId_key" ON "PrimaryCancellationRefundLink"("cancellationId","refundId");
CREATE INDEX "PrimaryCancellationRefundLink_cancellationId_idx" ON "PrimaryCancellationRefundLink"("cancellationId");
ALTER TABLE "PrimaryCancellationRefundLink" ADD CONSTRAINT "PrimaryCancellationRefundLink_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "PrimaryEventCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryCancellationRefundLink" ADD CONSTRAINT "PrimaryCancellationRefundLink_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION lock_open_primary_cancellation(cancellation_id TEXT, evidence_kind TEXT) RETURNS "PrimaryCancellationStatus" AS $$
DECLARE cancellation_status "PrimaryCancellationStatus";
BEGIN
  SELECT status INTO cancellation_status FROM "PrimaryEventCancellation" WHERE id=cancellation_id FOR UPDATE;
  IF cancellation_status IS NULL OR cancellation_status NOT IN ('ACTIVE','REFUNDING','RECONCILIATION_REQUIRED') THEN
    RAISE EXCEPTION '% evidence requires an active unresolved cancellation', evidence_kind;
  END IF;
  RETURN cancellation_status;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gate_primary_cancellation_snapshot_insert() RETURNS trigger AS $$
DECLARE cancellation_status "PrimaryCancellationStatus";
BEGIN
  SELECT status INTO cancellation_status FROM "PrimaryEventCancellation" WHERE id=NEW."cancellationId" FOR UPDATE;
  IF cancellation_status<>'REQUESTED' OR pg_trigger_depth()<>2 THEN RAISE EXCEPTION 'Cancellation snapshots are database-created only during activation'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCancellationSnapshotTicket_activation_only" BEFORE INSERT ON "PrimaryCancellationSnapshotTicket" FOR EACH ROW EXECUTE FUNCTION gate_primary_cancellation_snapshot_insert();

CREATE OR REPLACE FUNCTION gate_primary_cancellation_batch_insert() RETURNS trigger AS $$
BEGIN PERFORM lock_open_primary_cancellation(NEW."cancellationId",'batch'); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCancellationBatch_open_parent" BEFORE INSERT ON "PrimaryCancellationBatch" FOR EACH ROW EXECUTE FUNCTION gate_primary_cancellation_batch_insert();

CREATE OR REPLACE FUNCTION gate_primary_cancellation_obligation_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."cancellationId" IS NOT NULL THEN PERFORM lock_open_primary_cancellation(NEW."cancellationId",'obligation'); END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundObligation_open_cancellation" BEFORE INSERT ON "PrimaryRefundObligation" FOR EACH ROW EXECUTE FUNCTION gate_primary_cancellation_obligation_insert();

CREATE OR REPLACE FUNCTION gate_primary_cancellation_batch_ticket_insert() RETURNS trigger AS $$
BEGIN PERFORM lock_open_primary_cancellation(NEW."cancellationId",'batch-ticket'); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCancellationBatchTicket_open_parent" BEFORE INSERT ON "PrimaryCancellationBatchTicket" FOR EACH ROW EXECUTE FUNCTION gate_primary_cancellation_batch_ticket_insert();

CREATE OR REPLACE FUNCTION gate_primary_cancellation_waiver_insert() RETURNS trigger AS $$
DECLARE target_cancellation TEXT;
BEGIN
  SELECT "cancellationId" INTO target_cancellation FROM "PrimaryRefundObligation" WHERE id=NEW."obligationId";
  IF target_cancellation IS NOT NULL THEN PERFORM lock_open_primary_cancellation(target_cancellation,'waiver approval'); END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryObligationWaiverApproval_open_cancellation" BEFORE INSERT ON "PrimaryObligationWaiverApproval" FOR EACH ROW EXECUTE FUNCTION gate_primary_cancellation_waiver_insert();

CREATE OR REPLACE FUNCTION gate_primary_cancellation_revocation_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."cancellationId" IS NOT NULL THEN PERFORM lock_open_primary_cancellation(NEW."cancellationId",'revocation'); END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryAdmissionRevocation_open_cancellation" BEFORE INSERT ON "PrimaryAdmissionRevocation" FOR EACH ROW EXECUTE FUNCTION gate_primary_cancellation_revocation_insert();

CREATE OR REPLACE FUNCTION validate_primary_cancellation_refund_link() RETURNS trigger AS $$
DECLARE cancellation_row "PrimaryEventCancellation"; refund_row "PrimaryRefund";
BEGIN
  SELECT * INTO cancellation_row FROM "PrimaryEventCancellation" WHERE id=NEW."cancellationId" FOR UPDATE;
  IF cancellation_row.status NOT IN ('ACTIVE','REFUNDING','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'Cancellation-refund provenance requires an active unresolved cancellation'; END IF;
  SELECT * INTO refund_row FROM "PrimaryRefund" WHERE id=NEW."refundId" FOR UPDATE;
  IF refund_row.status<>'REQUESTED' OR EXISTS (SELECT 1 FROM "PrimaryRefundItem" WHERE "refundId"=refund_row.id) OR EXISTS (SELECT 1 FROM "PrimaryRefundProviderAttempt" WHERE "refundId"=refund_row.id) THEN RAISE EXCEPTION 'Cancellation-refund provenance must precede refund materialization and authorization'; END IF;
  IF refund_row."organizerId"<>cancellation_row."organizerId" OR refund_row."eventId"<>cancellation_row."eventId" OR refund_row."policyVersionId"<>cancellation_row."policyVersionId" THEN RAISE EXCEPTION 'Cancellation-refund provenance scope mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCancellationRefundLink_scope" BEFORE INSERT ON "PrimaryCancellationRefundLink" FOR EACH ROW EXECUTE FUNCTION validate_primary_cancellation_refund_link();
CREATE TRIGGER "PrimaryCancellationRefundLink_immutable" BEFORE UPDATE OR DELETE ON "PrimaryCancellationRefundLink" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();

CREATE OR REPLACE FUNCTION validate_primary_obligation_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PrimaryOrder" o WHERE o.id=NEW."orderId" AND o."organizerId"=NEW."organizerId" AND o."eventId"=NEW."eventId" AND o.currency=NEW.currency) THEN RAISE EXCEPTION 'Obligation order/event/organizer/currency mismatch'; END IF;
  IF NEW."cancellationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryEventCancellation" c WHERE c.id=NEW."cancellationId" AND c."organizerId"=NEW."organizerId" AND c."eventId"=NEW."eventId") THEN RAISE EXCEPTION 'Obligation cancellation scope mismatch'; END IF;
  IF NEW."refundId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryRefund" r WHERE r.id=NEW."refundId" AND r."organizerId"=NEW."organizerId" AND r."eventId"=NEW."eventId" AND r."orderId"=NEW."orderId" AND r.currency=NEW.currency AND NEW."amountMinor"=r."requestedAmountMinor") THEN RAISE EXCEPTION 'Obligation refund scope mismatch'; END IF;
  IF NEW."cancellationId" IS NOT NULL AND NEW."refundId" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "PrimaryCancellationRefundLink" l WHERE l."cancellationId"=NEW."cancellationId" AND l."refundId"=NEW."refundId") THEN RAISE EXCEPTION 'Cancellation obligation requires immutable pre-authorization refund provenance'; END IF;
    PERFORM assert_primary_refund_complete(NEW."refundId");
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
