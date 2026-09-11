-- DropIndex
DROP INDEX "PrimaryOrderLine_orderId_key";
DROP INDEX "PrimaryAdmissionTicket_orderId_unitNumber_key";
CREATE UNIQUE INDEX "PrimaryAdmissionTicket_orderLineId_unitNumber_key" ON "PrimaryAdmissionTicket"("orderLineId", "unitNumber");

-- CreateTable
CREATE TABLE "PrimaryRefundTicketClaim" (
    "admissionTicketId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "refundItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundTicketClaim_pkey" PRIMARY KEY ("admissionTicketId")
);

-- CreateTable
CREATE TABLE "PrimaryCheckedInRefundApproval" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "admissionTicketId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fraudReview" TEXT NOT NULL,
    "costBearer" "PrimaryPolicyLiabilityOwner" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryCheckedInRefundApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryCancellationBatchTicket" (
    "id" TEXT NOT NULL,
    "cancellationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "admissionTicketId" TEXT NOT NULL,
    "refundItemId" TEXT,
    "obligationId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryCancellationBatchTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryObligationWaiverApproval" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryObligationWaiverApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundTicketClaim_refundItemId_key" ON "PrimaryRefundTicketClaim"("refundItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundTicketClaim_admissionTicketId_refundId_key" ON "PrimaryRefundTicketClaim"("admissionTicketId", "refundId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryCheckedInRefundApproval_refundId_admissionTicketId_key" ON "PrimaryCheckedInRefundApproval"("refundId", "admissionTicketId");

-- CreateIndex
CREATE INDEX "PrimaryCancellationBatchTicket_batchId_idx" ON "PrimaryCancellationBatchTicket"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryCancellationBatchTicket_cancellationId_admissionTick_key" ON "PrimaryCancellationBatchTicket"("cancellationId", "admissionTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryObligationWaiverApproval_obligationId_key" ON "PrimaryObligationWaiverApproval"("obligationId");

-- CreateIndex
CREATE INDEX "PrimaryOrderLine_orderId_idx" ON "PrimaryOrderLine"("orderId");

-- AddForeignKey
ALTER TABLE "PrimaryRefundTicketClaim" ADD CONSTRAINT "PrimaryRefundTicketClaim_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundTicketClaim" ADD CONSTRAINT "PrimaryRefundTicketClaim_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundTicketClaim" ADD CONSTRAINT "PrimaryRefundTicketClaim_refundItemId_fkey" FOREIGN KEY ("refundItemId") REFERENCES "PrimaryRefundItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCheckedInRefundApproval" ADD CONSTRAINT "PrimaryCheckedInRefundApproval_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCheckedInRefundApproval" ADD CONSTRAINT "PrimaryCheckedInRefundApproval_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCheckedInRefundApproval" ADD CONSTRAINT "PrimaryCheckedInRefundApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCancellationBatchTicket" ADD CONSTRAINT "PrimaryCancellationBatchTicket_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "PrimaryEventCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCancellationBatchTicket" ADD CONSTRAINT "PrimaryCancellationBatchTicket_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PrimaryCancellationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCancellationBatchTicket" ADD CONSTRAINT "PrimaryCancellationBatchTicket_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCancellationBatchTicket" ADD CONSTRAINT "PrimaryCancellationBatchTicket_refundItemId_fkey" FOREIGN KEY ("refundItemId") REFERENCES "PrimaryRefundItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCancellationBatchTicket" ADD CONSTRAINT "PrimaryCancellationBatchTicket_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PrimaryRefundObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryObligationWaiverApproval" ADD CONSTRAINT "PrimaryObligationWaiverApproval_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PrimaryRefundObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryObligationWaiverApproval" ADD CONSTRAINT "PrimaryObligationWaiverApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrimaryCheckedInRefundApproval" ADD CONSTRAINT "PrimaryCheckedInRefundApproval_values_check" CHECK (
  "evidenceDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("reason")) > 0 AND length(btrim("fraudReview")) > 0
);
ALTER TABLE "PrimaryCancellationBatchTicket" ADD CONSTRAINT "PrimaryCancellationBatchTicket_values_check" CHECK ("amountMinor" > 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "PrimaryObligationWaiverApproval" ADD CONSTRAINT "PrimaryObligationWaiverApproval_values_check" CHECK ("evidenceDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("reason")) > 0);

CREATE UNIQUE INDEX "PrimaryEventCancellation_one_active_generation"
ON "PrimaryEventCancellation"("eventId") WHERE status IN ('ACTIVE','REFUNDING','RECONCILIATION_REQUIRED');

-- Replace the original scalar preflight with line-by-line validation. This is
-- correct for the current one-line service and for future mixed-line orders.
CREATE OR REPLACE FUNCTION materialize_primary_purchase_allocations(target_order_id TEXT) RETURNS INTEGER AS $$
DECLARE invalid_line RECORD; inserted_count INTEGER;
BEGIN
  SELECT l.id, l.quantity, count(t.id)::INTEGER actual_units INTO invalid_line
  FROM "PrimaryOrderLine" l LEFT JOIN "PrimaryAdmissionTicket" t ON t."orderLineId"=l.id
  WHERE l."orderId"=target_order_id GROUP BY l.id,l.quantity
  HAVING count(t.id)<>l.quantity LIMIT 1;
  IF invalid_line.id IS NOT NULL THEN RAISE EXCEPTION 'Incomplete immutable admission units for order line %', invalid_line.id; END IF;
  IF NOT EXISTS (SELECT 1 FROM "PrimaryOrderLine" WHERE "orderId"=target_order_id) THEN RAISE EXCEPTION 'Order has no immutable lines'; END IF;
  IF EXISTS (SELECT 1 FROM "PrimaryOrderPriceComponent" c JOIN "PrimaryOrder" o ON o.id=c."orderId" WHERE c."orderId"=target_order_id AND (c.currency<>o.currency OR c."amountMinor"<1)) THEN RAISE EXCEPTION 'Unsupported or inconsistent immutable component evidence'; END IF;

  WITH ranked AS (
    SELECT c.id component_id,c."orderId" order_id,c.currency,c."amountMinor",c.code,t.id ticket_id,
      row_number() OVER (PARTITION BY c.id ORDER BY t."orderLineId",t."unitNumber",c.id)::INTEGER rank,
      count(*) OVER (PARTITION BY c.id)::INTEGER units
    FROM "PrimaryOrderPriceComponent" c JOIN "PrimaryAdmissionTicket" t ON t."orderLineId"=c."orderLineId"
    WHERE c."orderId"=target_order_id
  ), materialized AS (
    SELECT encode(digest(component_id||':'||ticket_id||':v1','sha256'),'hex') id,order_id,component_id,ticket_id,
      ("amountMinor"/units)+CASE WHEN rank<=("amountMinor"%units) THEN 1 ELSE 0 END amount_minor,currency,rank,code
    FROM ranked
  ), allocation_digests AS (
    SELECT component_id,encode(digest(string_agg(ticket_id||':'||amount_minor,',' ORDER BY ticket_id),'sha256'),'hex') allocation_digest
    FROM materialized GROUP BY component_id
  )
  INSERT INTO "PrimaryPurchaseAllocation" (id,"orderId","orderComponentId","admissionTicketId","amountMinor",currency,refundable,"liabilityOwner","remainderRank","algorithmVersion","policyVersionId","allocationSetDigest")
  SELECT m.id,m.order_id,m.component_id,m.ticket_id,m.amount_minor,m.currency,true,
    CASE WHEN m.code='TRUEFANTIX_ADMIN_FEE' THEN 'TRUEFANTIX'::"PrimaryPolicyLiabilityOwner" ELSE 'ORGANIZER'::"PrimaryPolicyLiabilityOwner" END,
    m.rank,1,'primary-refund-policy-v1',d.allocation_digest FROM materialized m JOIN allocation_digests d USING(component_id)
  ON CONFLICT ("orderComponentId","admissionTicketId") DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF EXISTS (SELECT 1 FROM "PrimaryOrderPriceComponent" c LEFT JOIN "PrimaryPurchaseAllocation" a ON a."orderComponentId"=c.id WHERE c."orderId"=target_order_id GROUP BY c.id,c."amountMinor" HAVING coalesce(sum(a."amountMinor"),0)<>c."amountMinor") THEN RAISE EXCEPTION 'Allocation reconciliation failed'; END IF;
  RETURN inserted_count;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_primary_checked_in_approval() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PrimaryRefund" r JOIN "PrimaryAdmissionTicket" t ON t."orderId"=r."orderId" WHERE r.id=NEW."refundId" AND t.id=NEW."admissionTicketId") THEN RAISE EXCEPTION 'Checked-in approval aggregate mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id=NEW."approvedByUserId" AND u."emailVerifiedAt" IS NOT NULL AND NOT u."isBanned") THEN RAISE EXCEPTION 'Checked-in approval requires a current verified approver'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCheckedInRefundApproval_scope" BEFORE INSERT ON "PrimaryCheckedInRefundApproval" FOR EACH ROW EXECUTE FUNCTION validate_primary_checked_in_approval();

CREATE OR REPLACE FUNCTION validate_and_claim_primary_refund_item() RETURNS trigger AS $$
DECLARE ticket_status "PrimaryAdmissionStatus";
BEGIN
  SELECT status INTO ticket_status FROM "PrimaryAdmissionTicket" WHERE id=NEW."admissionTicketId" FOR UPDATE;
  IF ticket_status='CHECKED_IN' AND NOT EXISTS (SELECT 1 FROM "PrimaryCheckedInRefundApproval" a WHERE a."refundId"=NEW."refundId" AND a."admissionTicketId"=NEW."admissionTicketId") THEN RAISE EXCEPTION 'Checked-in refund requires immutable supervised approval'; END IF;
  INSERT INTO "PrimaryRefundTicketClaim" ("admissionTicketId","refundId","refundItemId") VALUES (NEW."admissionTicketId",NEW."refundId",NEW.id);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundItem_claim" AFTER INSERT ON "PrimaryRefundItem" FOR EACH ROW EXECUTE FUNCTION validate_and_claim_primary_refund_item();

INSERT INTO "PrimaryRefundTicketClaim" ("admissionTicketId","refundId","refundItemId")
SELECT "admissionTicketId","refundId",id FROM "PrimaryRefundItem" ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION validate_primary_refund_allocation_total() RETURNS trigger AS $$
DECLARE original_amount INTEGER; used_amount BIGINT;
BEGIN
  SELECT "amountMinor" INTO original_amount FROM "PrimaryPurchaseAllocation" WHERE id=NEW."purchaseAllocationId" FOR UPDATE;
  SELECT coalesce(sum("amountMinor"),0) INTO used_amount FROM "PrimaryRefundAllocation" WHERE "purchaseAllocationId"=NEW."purchaseAllocationId";
  IF used_amount+NEW."amountMinor">original_amount THEN RAISE EXCEPTION 'Cumulative refund allocation exceeds purchase allocation'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundAllocation_cumulative" BEFORE INSERT ON "PrimaryRefundAllocation" FOR EACH ROW EXECUTE FUNCTION validate_primary_refund_allocation_total();

CREATE OR REPLACE FUNCTION assert_primary_refund_complete(refund_id TEXT) RETURNS VOID AS $$
DECLARE parent "PrimaryRefund"; item_total BIGINT; allocation_total BIGINT;
BEGIN
  SELECT * INTO parent FROM "PrimaryRefund" WHERE id=refund_id FOR UPDATE;
  SELECT coalesce(sum("requestedMinor"),0) INTO item_total FROM "PrimaryRefundItem" WHERE "refundId"=refund_id;
  IF item_total<>parent."requestedAmountMinor" THEN RAISE EXCEPTION 'Refund item total is incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM "PrimaryRefundItem" i LEFT JOIN "PrimaryRefundAllocation" a ON a."refundItemId"=i.id WHERE i."refundId"=refund_id GROUP BY i.id,i."requestedMinor" HAVING coalesce(sum(a."amountMinor"),0)<>i."requestedMinor") THEN RAISE EXCEPTION 'Refund item allocation total is incomplete'; END IF;
  SELECT coalesce(sum("amountMinor"),0) INTO allocation_total FROM "PrimaryRefundAllocation" WHERE "refundId"=refund_id;
  IF allocation_total<>parent."requestedAmountMinor" THEN RAISE EXCEPTION 'Refund allocation total does not reconcile'; END IF;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_primary_refund() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PrimaryRefund rows cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW."orderId",NEW."paymentAttemptId",NEW."requestedByUserId",NEW."policyVersionId",NEW."requestKey",NEW."commandDigest",NEW.reason,NEW."requestedAmountMinor",NEW.currency,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD."orderId",OLD."paymentAttemptId",OLD."requestedByUserId",OLD."policyVersionId",OLD."requestKey",OLD."commandDigest",OLD.reason,OLD."requestedAmountMinor",OLD.currency,OLD."createdAt") THEN RAISE EXCEPTION 'PrimaryRefund command evidence is immutable'; END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','CANCELLED_BEFORE_PROVIDER') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Terminal refund cannot transition'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='REQUESTED' AND NEW.status IN ('PROVIDER_PENDING','CANCELLED_BEFORE_PROVIDER')) OR (OLD.status IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED') AND NEW.status IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED','SUCCEEDED','FAILED'))) THEN RAISE EXCEPTION 'Invalid refund transition'; END IF;
  IF OLD.status='REQUESTED' AND NEW.status='PROVIDER_PENDING' THEN PERFORM assert_primary_refund_complete(OLD.id); END IF;
  IF NEW.status='FAILED' AND EXISTS (SELECT 1 FROM "PrimaryRefundProviderAttempt" a WHERE a."refundId"=OLD.id AND a.status IN ('SEND_UNCERTAIN','PROVIDER_ATTACHED')) THEN RAISE EXCEPTION 'Refund cannot be abandoned while an attempt may succeed'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_primary_next_refund_attempt() RETURNS trigger AS $$
DECLARE parent "PrimaryRefund"; prior "PrimaryRefundProviderAttempt";
BEGIN
  SELECT * INTO parent FROM "PrimaryRefund" WHERE id=NEW."refundId" FOR UPDATE;
  IF parent.status<>'PROVIDER_PENDING' THEN RAISE EXCEPTION 'Parent refund is not retryable'; END IF;
  PERFORM assert_primary_refund_complete(parent.id);
  IF NEW."expectedAmountMinor"<>parent."requestedAmountMinor" OR NEW.currency<>parent.currency THEN RAISE EXCEPTION 'Provider attempt amount/currency mismatch'; END IF;
  IF NEW.ordinal=1 THEN RETURN NEW; END IF;
  SELECT * INTO prior FROM "PrimaryRefundProviderAttempt" WHERE "refundId"=NEW."refundId" AND ordinal=NEW.ordinal-1 FOR UPDATE;
  IF prior.id IS NULL OR prior.status<>'TERMINAL_FAILED' OR prior."terminalEvidenceHash" IS NULL THEN RAISE EXCEPTION 'Prior attempt is not authenticated terminal-impossible'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_primary_obligation_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PrimaryOrder" o WHERE o.id=NEW."orderId" AND o."organizerId"=NEW."organizerId" AND o."eventId"=NEW."eventId" AND o.currency=NEW.currency) THEN RAISE EXCEPTION 'Obligation order/event/organizer/currency mismatch'; END IF;
  IF NEW."cancellationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryEventCancellation" c WHERE c.id=NEW."cancellationId" AND c."organizerId"=NEW."organizerId" AND c."eventId"=NEW."eventId") THEN RAISE EXCEPTION 'Obligation cancellation scope mismatch'; END IF;
  IF NEW."refundId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryRefund" r WHERE r.id=NEW."refundId" AND r."organizerId"=NEW."organizerId" AND r."eventId"=NEW."eventId" AND r."orderId"=NEW."orderId" AND r.currency=NEW.currency AND NEW."amountMinor"<=r."requestedAmountMinor") THEN RAISE EXCEPTION 'Obligation refund scope mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundObligation_scope" BEFORE INSERT ON "PrimaryRefundObligation" FOR EACH ROW EXECUTE FUNCTION validate_primary_obligation_scope();

CREATE OR REPLACE FUNCTION validate_primary_revocation_scope_v2() RETURNS trigger AS $$
BEGIN
  IF NEW."refundId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryRefund" r JOIN "PrimaryAdmissionTicket" t ON t."orderId"=r."orderId" WHERE r.id=NEW."refundId" AND t.id=NEW."admissionTicketId" AND r."organizerId"=NEW."organizerId" AND r."eventId"=NEW."eventId" AND r."policyVersionId"=NEW."policyVersionId") THEN RAISE EXCEPTION 'Revocation refund scope mismatch'; END IF;
  IF NEW."cancellationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryEventCancellation" c WHERE c.id=NEW."cancellationId" AND c."organizerId"=NEW."organizerId" AND c."eventId"=NEW."eventId" AND c."policyVersionId"=NEW."policyVersionId") THEN RAISE EXCEPTION 'Revocation cancellation scope mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryAdmissionRevocation_scope_v2" BEFORE INSERT ON "PrimaryAdmissionRevocation" FOR EACH ROW EXECUTE FUNCTION validate_primary_revocation_scope_v2();

CREATE OR REPLACE FUNCTION validate_primary_cancellation_batch_ticket() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PrimaryCancellationBatch" b JOIN "PrimaryEventCancellation" c ON c.id=b."cancellationId" JOIN "PrimaryAdmissionTicket" t ON t."eventId"=c."eventId" JOIN "PrimaryRefundObligation" o ON o.id=NEW."obligationId" WHERE b.id=NEW."batchId" AND b."cancellationId"=NEW."cancellationId" AND t.id=NEW."admissionTicketId" AND o."cancellationId"=c.id AND o."orderId"=t."orderId" AND o.currency=NEW.currency AND NEW."amountMinor"<=o."amountMinor" AND t.id BETWEEN b."firstTicketId" AND b."lastTicketId") THEN RAISE EXCEPTION 'Cancellation batch ticket aggregate mismatch'; END IF;
  IF NEW."refundItemId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PrimaryRefundItem" i WHERE i.id=NEW."refundItemId" AND i."admissionTicketId"=NEW."admissionTicketId") THEN RAISE EXCEPTION 'Cancellation batch refund item mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryCancellationBatchTicket_scope" BEFORE INSERT ON "PrimaryCancellationBatchTicket" FOR EACH ROW EXECUTE FUNCTION validate_primary_cancellation_batch_ticket();

CREATE OR REPLACE FUNCTION validate_primary_waiver_approval() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id=NEW."approvedByUserId" AND u."emailVerifiedAt" IS NOT NULL AND NOT u."isBanned") THEN RAISE EXCEPTION 'Waiver requires a current verified approver'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryObligationWaiverApproval_scope" BEFORE INSERT ON "PrimaryObligationWaiverApproval" FOR EACH ROW EXECUTE FUNCTION validate_primary_waiver_approval();

CREATE OR REPLACE FUNCTION protect_primary_obligation() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Obligation cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW."orderId",NEW."cancellationId",NEW."refundId",NEW.cause,NEW."amountMinor",NEW.currency,NEW."idempotencyKey",NEW.reason,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD."orderId",OLD."cancellationId",OLD."refundId",OLD.cause,OLD."amountMinor",OLD.currency,OLD."idempotencyKey",OLD.reason,OLD."createdAt") THEN RAISE EXCEPTION 'Obligation evidence is immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='OPEN' AND NEW.status IN ('REFUND_LINKED','WAIVED_WITH_APPROVAL','RECONCILIATION_REQUIRED')) OR (OLD.status='REFUND_LINKED' AND NEW.status IN ('SATISFIED','RECONCILIATION_REQUIRED')) OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('REFUND_LINKED','SATISFIED','WAIVED_WITH_APPROVAL'))) THEN RAISE EXCEPTION 'Invalid obligation transition'; END IF;
  IF NEW.status='WAIVED_WITH_APPROVAL' AND OLD.status<>'WAIVED_WITH_APPROVAL' AND NOT EXISTS (SELECT 1 FROM "PrimaryObligationWaiverApproval" a WHERE a."obligationId"=OLD.id) THEN RAISE EXCEPTION 'Waiver requires immutable named approval'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_primary_cancellation() RETURNS trigger AS $$
DECLARE actual_count INTEGER; actual_amount BIGINT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancellation cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW.generation,NEW."policyVersionId",NEW."requestedByUserId",NEW."requestKey",NEW."commandDigest",NEW.reason,NEW."snapshotMaxTicketId",NEW."expectedTicketCount",NEW."expectedAmountMinor",NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD.generation,OLD."policyVersionId",OLD."requestedByUserId",OLD."requestKey",OLD."commandDigest",OLD.reason,OLD."snapshotMaxTicketId",OLD."expectedTicketCount",OLD."expectedAmountMinor",OLD."createdAt") THEN RAISE EXCEPTION 'Cancellation snapshot is immutable'; END IF;
  IF NEW."processedTicketCount"<>OLD."processedTicketCount" OR NEW."processedAmountMinor"<>OLD."processedAmountMinor" THEN RAISE EXCEPTION 'Cancellation coverage counters are database-derived'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='REQUESTED' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status IN ('REFUNDING','RECONCILIATION_REQUIRED')) OR (OLD.status='REFUNDING' AND NEW.status IN ('RESOLVED','RECONCILIATION_REQUIRED')) OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('REFUNDING','RESOLVED'))) THEN RAISE EXCEPTION 'Invalid cancellation transition'; END IF;
  IF NEW.status='RESOLVED' AND OLD.status<>'RESOLVED' THEN
    IF EXISTS (SELECT 1 FROM "PrimaryCancellationBatch" b LEFT JOIN "PrimaryCancellationBatchTicket" t ON t."batchId"=b.id WHERE b."cancellationId"=OLD.id GROUP BY b.id,b."processedTicketCount",b."processedAmountMinor" HAVING count(t.id)<>b."processedTicketCount" OR coalesce(sum(t."amountMinor"),0)<>b."processedAmountMinor") THEN RAISE EXCEPTION 'Cancellation batch evidence is incomplete'; END IF;
    SELECT count(*)::INTEGER,coalesce(sum("amountMinor"),0) INTO actual_count,actual_amount FROM "PrimaryCancellationBatchTicket" WHERE "cancellationId"=OLD.id;
    IF actual_count<>OLD."expectedTicketCount" OR actual_amount<>OLD."expectedAmountMinor" OR EXISTS (SELECT 1 FROM "PrimaryRefundObligation" o WHERE o."cancellationId"=OLD.id AND o.status NOT IN ('SATISFIED','WAIVED_WITH_APPROVAL')) THEN RAISE EXCEPTION 'Cancellation coverage is incomplete'; END IF;
    NEW."processedTicketCount":=actual_count; NEW."processedAmountMinor":=actual_amount;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryRefundTicketClaim_immutable" BEFORE UPDATE OR DELETE ON "PrimaryRefundTicketClaim" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryCheckedInRefundApproval_immutable" BEFORE UPDATE OR DELETE ON "PrimaryCheckedInRefundApproval" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryCancellationBatchTicket_immutable" BEFORE UPDATE OR DELETE ON "PrimaryCancellationBatchTicket" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryObligationWaiverApproval_immutable" BEFORE UPDATE OR DELETE ON "PrimaryObligationWaiverApproval" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
