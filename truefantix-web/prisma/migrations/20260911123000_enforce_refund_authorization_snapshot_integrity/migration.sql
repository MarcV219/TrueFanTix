CREATE TABLE "PrimaryCancellationSnapshotTicket" (
  "id" TEXT NOT NULL,
  "cancellationId" TEXT NOT NULL,
  "admissionTicketId" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryCancellationSnapshotTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryCancellationSnapshotTicket_values_check" CHECK ("amountMinor" > 0 AND "currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "PrimaryCancellationSnapshotTicket_cancellationId_admissionT_key" ON "PrimaryCancellationSnapshotTicket"("cancellationId","admissionTicketId");
CREATE INDEX "PrimaryCancellationSnapshotTicket_cancellationId_idx" ON "PrimaryCancellationSnapshotTicket"("cancellationId");
ALTER TABLE "PrimaryCancellationSnapshotTicket" ADD CONSTRAINT "PrimaryCancellationSnapshotTicket_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "PrimaryEventCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryCancellationSnapshotTicket" ADD CONSTRAINT "PrimaryCancellationSnapshotTicket_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryCancellationSnapshotTicket" ADD CONSTRAINT "PrimaryCancellationSnapshotTicket_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PrimaryRefundPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION lock_requested_primary_refund_item() RETURNS trigger AS $$
DECLARE parent_status "PrimaryRefundStatus";
BEGIN
  SELECT status INTO parent_status FROM "PrimaryRefund" WHERE id=NEW."refundId" FOR UPDATE;
  IF parent_status IS NULL OR parent_status<>'REQUESTED' THEN RAISE EXCEPTION 'Refund items may be created only while parent is REQUESTED'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundItem_requested_parent" BEFORE INSERT ON "PrimaryRefundItem" FOR EACH ROW EXECUTE FUNCTION lock_requested_primary_refund_item();

CREATE OR REPLACE FUNCTION validate_primary_refund_allocation_total() RETURNS trigger AS $$
DECLARE original_amount INTEGER; used_amount BIGINT; parent_status "PrimaryRefundStatus";
BEGIN
  SELECT r.status INTO parent_status FROM "PrimaryRefund" r JOIN "PrimaryRefundItem" i ON i."refundId"=r.id WHERE i.id=NEW."refundItemId" AND r.id=NEW."refundId" FOR UPDATE OF r;
  IF parent_status IS NULL OR parent_status<>'REQUESTED' THEN RAISE EXCEPTION 'Refund allocations may be created only while parent is REQUESTED'; END IF;
  SELECT "amountMinor" INTO original_amount FROM "PrimaryPurchaseAllocation" WHERE id=NEW."purchaseAllocationId" FOR UPDATE;
  SELECT coalesce(sum("amountMinor"),0) INTO used_amount FROM "PrimaryRefundAllocation" WHERE "purchaseAllocationId"=NEW."purchaseAllocationId";
  IF used_amount+NEW."amountMinor">original_amount THEN RAISE EXCEPTION 'Cumulative refund allocation exceeds purchase allocation'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION primary_refund_supervisor(user_id TEXT, organizer_id TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM "User" u WHERE u.id=user_id AND u."emailVerifiedAt" IS NOT NULL AND NOT u."isBanned"
      AND (u.role='ADMIN' OR EXISTS (SELECT 1 FROM "PrimaryOrganizerMembership" m WHERE m."userId"=u.id AND m."organizerId"=organizer_id AND m.status='ACTIVE' AND m.role IN ('OWNER','FINANCE')))
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION validate_primary_checked_in_approval() RETURNS trigger AS $$
DECLARE target_organizer TEXT;
BEGIN
  SELECT r."organizerId" INTO target_organizer FROM "PrimaryRefund" r JOIN "PrimaryAdmissionTicket" t ON t."orderId"=r."orderId" WHERE r.id=NEW."refundId" AND t.id=NEW."admissionTicketId";
  IF target_organizer IS NULL THEN RAISE EXCEPTION 'Checked-in approval aggregate mismatch'; END IF;
  IF NOT primary_refund_supervisor(NEW."approvedByUserId",target_organizer) THEN RAISE EXCEPTION 'Checked-in approval requires an authorized scoped supervisor'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_primary_waiver_approval() RETURNS trigger AS $$
DECLARE target_organizer TEXT;
BEGIN
  SELECT "organizerId" INTO target_organizer FROM "PrimaryRefundObligation" WHERE id=NEW."obligationId";
  IF target_organizer IS NULL OR NOT primary_refund_supervisor(NEW."approvedByUserId",target_organizer) THEN RAISE EXCEPTION 'Waiver requires an authorized scoped supervisor'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_primary_cancellation_snapshot() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Cancellation snapshot evidence is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCancellationSnapshotTicket_immutable" BEFORE UPDATE OR DELETE ON "PrimaryCancellationSnapshotTicket" FOR EACH ROW EXECUTE FUNCTION protect_primary_cancellation_snapshot();

CREATE OR REPLACE FUNCTION protect_primary_cancellation() RETURNS trigger AS $$
DECLARE actual_count INTEGER; actual_amount BIGINT; ticket_count INTEGER; snapshot_max TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancellation cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW.generation,NEW."policyVersionId",NEW."requestedByUserId",NEW."requestKey",NEW."commandDigest",NEW.reason,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD.generation,OLD."policyVersionId",OLD."requestedByUserId",OLD."requestKey",OLD."commandDigest",OLD.reason,OLD."createdAt") THEN RAISE EXCEPTION 'Cancellation command evidence is immutable'; END IF;
  IF NEW."processedTicketCount"<>OLD."processedTicketCount" OR NEW."processedAmountMinor"<>OLD."processedAmountMinor" THEN RAISE EXCEPTION 'Cancellation coverage counters are database-derived'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='REQUESTED' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status IN ('REFUNDING','RECONCILIATION_REQUIRED')) OR (OLD.status='REFUNDING' AND NEW.status IN ('RESOLVED','RECONCILIATION_REQUIRED')) OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('REFUNDING','RESOLVED'))) THEN RAISE EXCEPTION 'Invalid cancellation transition'; END IF;
  IF OLD.status='REQUESTED' AND NEW.status='ACTIVE' THEN
    IF EXISTS (SELECT 1 FROM "PrimaryAdmissionTicket" t WHERE t."eventId"=OLD."eventId" AND NOT EXISTS (SELECT 1 FROM "PrimaryPurchaseAllocation" a WHERE a."admissionTicketId"=t.id AND a.refundable AND a."policyVersionId"=OLD."policyVersionId")) THEN RAISE EXCEPTION 'Cancellation activation lacks authoritative purchase allocations'; END IF;
    INSERT INTO "PrimaryCancellationSnapshotTicket" (id,"cancellationId","admissionTicketId","policyVersionId","amountMinor",currency)
    SELECT md5(OLD.id||':'||t.id),OLD.id,t.id,OLD."policyVersionId",sum(a."amountMinor")::int,min(a.currency)
    FROM "PrimaryAdmissionTicket" t JOIN "PrimaryPurchaseAllocation" a ON a."admissionTicketId"=t.id AND a.refundable AND a."policyVersionId"=OLD."policyVersionId"
    WHERE t."eventId"=OLD."eventId" AND t."organizerId"=OLD."organizerId" GROUP BY t.id;
    SELECT count(*)::int,coalesce(sum("amountMinor"),0),coalesce(max("admissionTicketId"),'') INTO ticket_count,actual_amount,snapshot_max FROM "PrimaryCancellationSnapshotTicket" WHERE "cancellationId"=OLD.id;
    IF ticket_count=0 THEN RAISE EXCEPTION 'Cancellation activation has no authoritative ticket scope'; END IF;
    NEW."expectedTicketCount":=ticket_count; NEW."expectedAmountMinor":=actual_amount; NEW."snapshotMaxTicketId":=snapshot_max;
  ELSIF ROW(NEW."snapshotMaxTicketId",NEW."expectedTicketCount",NEW."expectedAmountMinor") IS DISTINCT FROM ROW(OLD."snapshotMaxTicketId",OLD."expectedTicketCount",OLD."expectedAmountMinor") THEN
    RAISE EXCEPTION 'Cancellation snapshot is immutable';
  END IF;
  IF NEW.status='RESOLVED' AND OLD.status<>'RESOLVED' THEN
    IF EXISTS (SELECT 1 FROM "PrimaryCancellationBatch" b LEFT JOIN "PrimaryCancellationBatchTicket" t ON t."batchId"=b.id WHERE b."cancellationId"=OLD.id GROUP BY b.id,b."processedTicketCount",b."processedAmountMinor" HAVING count(t.id)<>b."processedTicketCount" OR coalesce(sum(t."amountMinor"),0)<>b."processedAmountMinor") THEN RAISE EXCEPTION 'Cancellation batch evidence is incomplete'; END IF;
    IF EXISTS (SELECT 1 FROM "PrimaryCancellationSnapshotTicket" s LEFT JOIN "PrimaryCancellationBatchTicket" t ON t."cancellationId"=s."cancellationId" AND t."admissionTicketId"=s."admissionTicketId" WHERE s."cancellationId"=OLD.id AND (t.id IS NULL OR t."amountMinor"<>s."amountMinor" OR t.currency<>s.currency)) THEN RAISE EXCEPTION 'Cancellation authoritative ticket coverage is incomplete'; END IF;
    IF EXISTS (SELECT 1 FROM "PrimaryRefundObligation" o LEFT JOIN "PrimaryCancellationBatchTicket" t ON t."obligationId"=o.id WHERE o."cancellationId"=OLD.id GROUP BY o.id,o."amountMinor",o.status HAVING coalesce(sum(t."amountMinor"),0)<>o."amountMinor" OR o.status NOT IN ('SATISFIED','WAIVED_WITH_APPROVAL')) THEN RAISE EXCEPTION 'Cancellation obligation coverage is incomplete'; END IF;
    SELECT count(*)::int,coalesce(sum("amountMinor"),0) INTO actual_count,actual_amount FROM "PrimaryCancellationBatchTicket" WHERE "cancellationId"=OLD.id;
    IF actual_count<>OLD."expectedTicketCount" OR actual_amount<>OLD."expectedAmountMinor" THEN RAISE EXCEPTION 'Cancellation coverage is incomplete'; END IF;
    NEW."processedTicketCount":=actual_count; NEW."processedAmountMinor":=actual_amount;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_primary_cancellation_batch_ticket() RETURNS trigger AS $$
DECLARE obligation_amount INTEGER; already_claimed BIGINT;
BEGIN
  SELECT o."amountMinor" INTO obligation_amount FROM "PrimaryRefundObligation" o
  JOIN "PrimaryCancellationBatch" b ON b.id=NEW."batchId" AND b."cancellationId"=NEW."cancellationId"
  JOIN "PrimaryCancellationSnapshotTicket" s ON s."cancellationId"=NEW."cancellationId" AND s."admissionTicketId"=NEW."admissionTicketId" AND s."amountMinor"=NEW."amountMinor" AND s.currency=NEW.currency
  JOIN "PrimaryAdmissionTicket" t ON t.id=s."admissionTicketId" AND t.id BETWEEN b."firstTicketId" AND b."lastTicketId"
  JOIN "PrimaryEventCancellation" c ON c.id=s."cancellationId" AND c."policyVersionId"=s."policyVersionId"
  WHERE o.id=NEW."obligationId" AND o."cancellationId"=c.id AND o."organizerId"=c."organizerId" AND o."eventId"=c."eventId" AND o."orderId"=t."orderId" AND o.currency=NEW.currency FOR UPDATE OF o;
  IF obligation_amount IS NULL THEN RAISE EXCEPTION 'Cancellation batch ticket aggregate mismatch'; END IF;
  SELECT coalesce(sum("amountMinor"),0) INTO already_claimed FROM "PrimaryCancellationBatchTicket" WHERE "obligationId"=NEW."obligationId";
  IF already_claimed+NEW."amountMinor">obligation_amount THEN RAISE EXCEPTION 'Cancellation claims exceed obligation'; END IF;
  IF NEW."refundItemId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PrimaryRefundItem" i JOIN "PrimaryRefund" r ON r.id=i."refundId" JOIN "PrimaryRefundObligation" o ON o.id=NEW."obligationId"
    JOIN "PrimaryEventCancellation" c ON c.id=NEW."cancellationId"
    WHERE i.id=NEW."refundItemId" AND i."admissionTicketId"=NEW."admissionTicketId" AND i."requestedMinor"=NEW."amountMinor" AND i.currency=NEW.currency
      AND o."refundId"=r.id AND r."orderId"=o."orderId" AND r."organizerId"=c."organizerId" AND r."eventId"=c."eventId" AND r."policyVersionId"=c."policyVersionId" AND r.currency=NEW.currency
  ) THEN RAISE EXCEPTION 'Cancellation batch refund evidence mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
