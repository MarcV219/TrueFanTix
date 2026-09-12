CREATE OR REPLACE FUNCTION protect_primary_refund_attempt() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund attempts cannot be deleted'; END IF;
  IF ROW(NEW."refundId",NEW.ordinal,NEW."providerKey",NEW."expectedAmountMinor",NEW.currency,NEW."authorizationKey",NEW."authorizationDigest",NEW."authorizedByUserId",NEW."authorizationReason",NEW."createdAt") IS DISTINCT FROM ROW(OLD."refundId",OLD.ordinal,OLD."providerKey",OLD."expectedAmountMinor",OLD.currency,OLD."authorizationKey",OLD."authorizationDigest",OLD."authorizedByUserId",OLD."authorizationReason",OLD."createdAt") THEN RAISE EXCEPTION 'Refund attempt identity is immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='NOT_SENT' AND NEW.status IN ('SEND_UNCERTAIN','PROVIDER_ATTACHED','TERMINAL_FAILED')) OR (OLD.status='SEND_UNCERTAIN' AND NEW.status IN ('PROVIDER_ATTACHED','TERMINAL_FAILED','SUCCEEDED')) OR (OLD.status='PROVIDER_ATTACHED' AND NEW.status IN ('TERMINAL_FAILED','SUCCEEDED'))) THEN RAISE EXCEPTION 'Invalid refund attempt transition'; END IF;
  IF NEW.status='SUCCEEDED' AND OLD.status<>'SUCCEEDED' AND NOT EXISTS (
    SELECT 1 FROM "PrimaryRefundProviderEvent" e WHERE e."attemptId"=OLD.id
  ) THEN RAISE EXCEPTION 'Successful refund attempt requires immutable provider event evidence'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_primary_refund() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PrimaryRefund rows cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW."orderId",NEW."paymentAttemptId",NEW."requestedByUserId",NEW."policyVersionId",NEW."requestKey",NEW."commandDigest",NEW.reason,NEW."requestedAmountMinor",NEW.currency,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD."orderId",OLD."paymentAttemptId",OLD."requestedByUserId",OLD."policyVersionId",OLD."requestKey",OLD."commandDigest",OLD.reason,OLD."requestedAmountMinor",OLD.currency,OLD."createdAt") THEN RAISE EXCEPTION 'PrimaryRefund command evidence is immutable'; END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','CANCELLED_BEFORE_PROVIDER') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Terminal refund cannot transition'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='REQUESTED' AND NEW.status IN ('PROVIDER_PENDING','CANCELLED_BEFORE_PROVIDER')) OR (OLD.status IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED') AND NEW.status IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED','SUCCEEDED','FAILED'))) THEN RAISE EXCEPTION 'Invalid refund transition'; END IF;
  IF OLD.status='REQUESTED' AND NEW.status='PROVIDER_PENDING' THEN PERFORM assert_primary_refund_complete(OLD.id); END IF;
  IF NEW.status='FAILED' AND EXISTS (SELECT 1 FROM "PrimaryRefundProviderAttempt" a WHERE a."refundId"=OLD.id AND a.status IN ('SEND_UNCERTAIN','PROVIDER_ATTACHED')) THEN RAISE EXCEPTION 'Refund cannot be abandoned while an attempt may succeed'; END IF;
  IF NEW.status='SUCCEEDED' AND OLD.status<>'SUCCEEDED' AND NOT EXISTS (
    SELECT 1 FROM "PrimaryRefundProviderAttempt" a
    WHERE a."refundId"=OLD.id AND a.status='SUCCEEDED'
      AND a."expectedAmountMinor"=OLD."requestedAmountMinor" AND a.currency=OLD.currency
  ) THEN RAISE EXCEPTION 'Successful refund requires exact successful attempt evidence'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_primary_obligation() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Obligation cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW."orderId",NEW."cancellationId",NEW."refundId",NEW.cause,NEW."amountMinor",NEW.currency,NEW."idempotencyKey",NEW.reason,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD."orderId",OLD."cancellationId",OLD."refundId",OLD.cause,OLD."amountMinor",OLD.currency,OLD."idempotencyKey",OLD.reason,OLD."createdAt") THEN RAISE EXCEPTION 'Obligation evidence is immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='OPEN' AND NEW.status IN ('REFUND_LINKED','WAIVED_WITH_APPROVAL','RECONCILIATION_REQUIRED')) OR (OLD.status='REFUND_LINKED' AND NEW.status IN ('SATISFIED','RECONCILIATION_REQUIRED')) OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('REFUND_LINKED','SATISFIED','WAIVED_WITH_APPROVAL'))) THEN RAISE EXCEPTION 'Invalid obligation transition'; END IF;
  IF NEW.status='REFUND_LINKED' AND OLD.status<>'REFUND_LINKED' AND OLD."refundId" IS NULL THEN RAISE EXCEPTION 'Linked obligation requires immutable refund provenance'; END IF;
  IF NEW.status='SATISFIED' AND OLD.status<>'SATISFIED' AND NOT EXISTS (
    SELECT 1 FROM "PrimaryRefund" r
    WHERE r.id=OLD."refundId" AND r.status='SUCCEEDED'
      AND r."organizerId"=OLD."organizerId" AND r."eventId"=OLD."eventId"
      AND r."orderId"=OLD."orderId" AND r."requestedAmountMinor"=OLD."amountMinor"
      AND r.currency=OLD.currency
  ) THEN RAISE EXCEPTION 'Satisfied obligation requires exact successful refund evidence'; END IF;
  IF NEW.status='WAIVED_WITH_APPROVAL' AND OLD.status<>'WAIVED_WITH_APPROVAL' AND NOT EXISTS (SELECT 1 FROM "PrimaryObligationWaiverApproval" a WHERE a."obligationId"=OLD.id) THEN RAISE EXCEPTION 'Waiver requires immutable named approval'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

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
    IF EXISTS (
      SELECT 1 FROM "PrimaryCancellationBatchTicket" t
      JOIN "PrimaryRefundObligation" o ON o.id=t."obligationId"
      LEFT JOIN "PrimaryRefundItem" i ON i.id=t."refundItemId"
      LEFT JOIN "PrimaryRefund" r ON r.id=i."refundId"
      WHERE t."cancellationId"=OLD.id AND (
        (o.status='SATISFIED' AND (t."refundItemId" IS NULL OR r.id IS DISTINCT FROM o."refundId" OR r.status<>'SUCCEEDED' OR i."admissionTicketId"<>t."admissionTicketId" OR i."requestedMinor"<>t."amountMinor" OR i.currency<>t.currency))
        OR (o.status='WAIVED_WITH_APPROVAL' AND t."refundItemId" IS NOT NULL)
      )
    ) THEN RAISE EXCEPTION 'Cancellation ticket disposition evidence is incomplete'; END IF;
    IF EXISTS (
      SELECT 1 FROM "PrimaryCancellationSnapshotTicket" s
      WHERE s."cancellationId"=OLD.id AND NOT EXISTS (
        SELECT 1 FROM "PrimaryAdmissionRevocation" r
        WHERE r."cancellationId"=OLD.id AND r."admissionTicketId"=s."admissionTicketId"
          AND r."organizerId"=OLD."organizerId" AND r."eventId"=OLD."eventId"
          AND r."policyVersionId"=OLD."policyVersionId" AND r.cause='EVENT_CANCELLATION'
      )
    ) THEN RAISE EXCEPTION 'Cancellation revocation evidence is incomplete'; END IF;
    SELECT count(*)::int,coalesce(sum("amountMinor"),0) INTO actual_count,actual_amount FROM "PrimaryCancellationBatchTicket" WHERE "cancellationId"=OLD.id;
    IF actual_count<>OLD."expectedTicketCount" OR actual_amount<>OLD."expectedAmountMinor" THEN RAISE EXCEPTION 'Cancellation coverage is incomplete'; END IF;
    NEW."processedTicketCount":=actual_count; NEW."processedAmountMinor":=actual_amount;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
