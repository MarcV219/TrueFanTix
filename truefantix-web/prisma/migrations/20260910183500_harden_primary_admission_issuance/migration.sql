ALTER TABLE "PrimaryAdmissionCredential" DROP CONSTRAINT "PrimaryAdmissionCredential_payload_check";
ALTER TABLE "PrimaryAdmissionCredential" DROP COLUMN "signature";
ALTER TABLE "PrimaryAdmissionCredential" ADD CONSTRAINT "PrimaryAdmissionCredential_payload_check" CHECK (
  "payloadVersion" = 1 AND length("keyId") > 0 AND "payloadDigest" ~ '^[0-9a-f]{64}$'
);

CREATE OR REPLACE FUNCTION validate_primary_admission_ticket_insert()
RETURNS trigger AS $$
DECLARE
  line_quantity INTEGER;
  order_status "PrimaryOrderStatus";
  attempt_status "PrimaryPaymentAttemptStatus";
  exception_exists BOOLEAN;
BEGIN
  SELECT "quantity" INTO line_quantity
  FROM "PrimaryOrderLine"
  WHERE "id" = NEW."orderLineId"
    AND "orderId" = NEW."orderId"
    AND "reservationId" = NEW."reservationId"
    AND "ticketTypeId" = NEW."ticketTypeId"
  FOR SHARE;
  IF line_quantity IS NULL OR NEW."unitNumber" < 1 OR NEW."unitNumber" > line_quantity THEN
    RAISE EXCEPTION 'Admission unit is outside the immutable order-line quantity';
  END IF;

  SELECT "status" INTO order_status
  FROM "PrimaryOrder"
  WHERE "id" = NEW."orderId"
    AND "organizerId" = NEW."organizerId"
    AND "eventId" = NEW."eventId"
    AND "buyerUserId" = NEW."buyerUserId"
    AND "reservationId" = NEW."reservationId"
  FOR SHARE;
  IF order_status IS DISTINCT FROM 'PAID'::"PrimaryOrderStatus" THEN
    RAISE EXCEPTION 'Admission issuance requires a paid order';
  END IF;

  SELECT "status" INTO attempt_status
  FROM "PrimaryPaymentAttempt"
  WHERE "orderId" = NEW."orderId"
    AND "organizerId" = NEW."organizerId"
    AND "eventId" = NEW."eventId"
    AND "buyerUserId" = NEW."buyerUserId"
    AND "reservationId" = NEW."reservationId"
  FOR SHARE;
  IF attempt_status IS DISTINCT FROM 'SUCCEEDED'::"PrimaryPaymentAttemptStatus" THEN
    RAISE EXCEPTION 'Admission issuance requires a succeeded payment attempt';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM "PrimaryPaymentException" WHERE "attemptId" = (
      SELECT "id" FROM "PrimaryPaymentAttempt" WHERE "orderId" = NEW."orderId"
    )
  ) INTO exception_exists;
  IF exception_exists THEN
    RAISE EXCEPTION 'Admission issuance is blocked by payment exception evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryAdmissionTicket_eligibility"
BEFORE INSERT ON "PrimaryAdmissionTicket"
FOR EACH ROW EXECUTE FUNCTION validate_primary_admission_ticket_insert();
