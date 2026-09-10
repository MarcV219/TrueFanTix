-- Bind financial snapshots to their reservation scope, align INTEGER limits, and make evidence immutable.

ALTER TABLE "PrimaryInventoryReservation"
  ADD CONSTRAINT "PrimaryInventoryReservation_id_organizerId_eventId_buyerUserId_key"
    UNIQUE ("id", "organizerId", "eventId", "buyerUserId"),
  ADD CONSTRAINT "PrimaryInventoryReservation_id_ticketTypeId_key"
    UNIQUE ("id", "ticketTypeId");

ALTER TABLE "PrimaryOrder" ADD COLUMN "prepareReconciliationDelayMs" INTEGER;
ALTER TABLE "PrimaryOrderLine" ADD COLUMN "reservationId" TEXT;

UPDATE "PrimaryOrder" orders
SET "prepareReconciliationDelayMs" = COALESCE(
  (SELECT LEAST(2147483647, GREATEST(1, ROUND(EXTRACT(EPOCH FROM (reservation."reconciliationAfter" - reservation."paymentCommittedAt")) * 1000)))::INTEGER
   FROM "PrimaryInventoryReservation" reservation WHERE reservation."id" = orders."reservationId"),
  1800000
)
WHERE orders."status" = 'PAYMENT_PROCESSING';

UPDATE "PrimaryOrderLine" line
SET "reservationId" = orders."reservationId"
FROM "PrimaryOrder" orders
WHERE orders."id" = line."orderId";

ALTER TABLE "PrimaryOrderLine" ALTER COLUMN "reservationId" SET NOT NULL;

CREATE UNIQUE INDEX "PrimaryOrder_reservationId_organizerId_eventId_buyerUserId_key"
  ON "PrimaryOrder"("reservationId", "organizerId", "eventId", "buyerUserId");

ALTER TABLE "PrimaryOrder" DROP CONSTRAINT "PrimaryOrder_reservationId_fkey";
ALTER TABLE "PrimaryOrderLine" DROP CONSTRAINT "PrimaryOrderLine_ticketTypeId_fkey";

ALTER TABLE "PrimaryOrder"
  ADD CONSTRAINT "PrimaryOrder_reservation_scope_fkey"
  FOREIGN KEY ("reservationId", "organizerId", "eventId", "buyerUserId")
  REFERENCES "PrimaryInventoryReservation"("id", "organizerId", "eventId", "buyerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PrimaryOrderLine"
  ADD CONSTRAINT "PrimaryOrderLine_reservation_ticketType_fkey"
  FOREIGN KEY ("reservationId", "ticketTypeId")
  REFERENCES "PrimaryInventoryReservation"("id", "ticketTypeId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PrimaryOrderLine"
  ADD CONSTRAINT "PrimaryOrderLine_ticketTypeId_fkey"
  FOREIGN KEY ("ticketTypeId") REFERENCES "PrimaryTicketType"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrimaryOrder" DROP CONSTRAINT "PrimaryOrder_amounts_check";
ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_amounts_check"
  CHECK (
    "faceValueSubtotalMinor" > 0 AND
    "grossTotalMinor" >= "faceValueSubtotalMinor" AND
    "faceValueSubtotalMinor" <= 2147483647 AND
    "grossTotalMinor" <= 2147483647
  );

ALTER TABLE "PrimaryOrder" ADD CONSTRAINT "PrimaryOrder_prepare_command_check"
  CHECK (
    ("status" = 'PENDING_PAYMENT' AND "prepareIdempotencyKey" IS NULL AND "prepareReconciliationDelayMs" IS NULL) OR
    ("status" = 'PAYMENT_PROCESSING' AND "prepareIdempotencyKey" IS NOT NULL AND "prepareReconciliationDelayMs" > 0)
  );

ALTER TABLE "PrimaryOrderLine" DROP CONSTRAINT "PrimaryOrderLine_amounts_check";
ALTER TABLE "PrimaryOrderLine" ADD CONSTRAINT "PrimaryOrderLine_amounts_check"
  CHECK (
    "quantity" > 0 AND "quantity" <= 2147483647 AND
    "unitFaceValueMinor" > 0 AND "unitFaceValueMinor" <= 2147483647 AND
    "faceValueSubtotalMinor" > 0 AND "faceValueSubtotalMinor" <= 2147483647 AND
    "faceValueSubtotalMinor"::BIGINT = "quantity"::BIGINT * "unitFaceValueMinor"::BIGINT
  );

ALTER TABLE "PrimaryOrderPriceComponent" DROP CONSTRAINT "PrimaryOrderPriceComponent_amount_check";
ALTER TABLE "PrimaryOrderPriceComponent" ADD CONSTRAINT "PrimaryOrderPriceComponent_amount_check"
  CHECK (
    "amountMinor" > 0 AND "amountMinor" <= 2147483647 AND
    "allocationBaseMinor" >= 0 AND "allocationBaseMinor" <= 2147483647 AND
    "allocationRemainderUnits" >= 0 AND "allocationRemainderUnits" <= 2147483647
  );

CREATE FUNCTION "reject_primary_order_snapshot_change"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'primary order financial snapshots are append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."organizerId" IS DISTINCT FROM OLD."organizerId"
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."buyerUserId" IS DISTINCT FROM OLD."buyerUserId"
    OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."faceValueSubtotalMinor" IS DISTINCT FROM OLD."faceValueSubtotalMinor"
    OR NEW."grossTotalMinor" IS DISTINCT FROM OLD."grossTotalMinor"
    OR NEW."createIdempotencyKey" IS DISTINCT FROM OLD."createIdempotencyKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'primary order financial snapshot is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."status", NEW."prepareIdempotencyKey", NEW."prepareReconciliationDelayMs", NEW."paymentProcessingAt")
      IS DISTINCT FROM
     (OLD."status", OLD."prepareIdempotencyKey", OLD."prepareReconciliationDelayMs", OLD."paymentProcessingAt")
    AND NOT (
      OLD."status" = 'PENDING_PAYMENT' AND
      NEW."status" = 'PAYMENT_PROCESSING' AND
      OLD."prepareIdempotencyKey" IS NULL AND NEW."prepareIdempotencyKey" IS NOT NULL AND
      OLD."prepareReconciliationDelayMs" IS NULL AND NEW."prepareReconciliationDelayMs" > 0 AND
      OLD."paymentProcessingAt" IS NULL AND NEW."paymentProcessingAt" IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'primary order status metadata transition is not authorized' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_primary_order_evidence_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'primary order evidence records are immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryOrder_snapshot_immutable"
  BEFORE UPDATE OR DELETE ON "PrimaryOrder"
  FOR EACH ROW EXECUTE FUNCTION "reject_primary_order_snapshot_change"();

CREATE TRIGGER "PrimaryOrderLine_immutable"
  BEFORE UPDATE OR DELETE ON "PrimaryOrderLine"
  FOR EACH ROW EXECUTE FUNCTION "reject_primary_order_evidence_change"();

CREATE TRIGGER "PrimaryOrderPriceComponent_immutable"
  BEFORE UPDATE OR DELETE ON "PrimaryOrderPriceComponent"
  FOR EACH ROW EXECUTE FUNCTION "reject_primary_order_evidence_change"();
