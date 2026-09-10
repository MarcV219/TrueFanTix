CREATE TYPE "PrimaryAdmissionStatus" AS ENUM ('ISSUED', 'VOIDED');

CREATE UNIQUE INDEX "PrimaryOrderLine_id_orderId_reservationId_ticketTypeId_key"
ON "PrimaryOrderLine"("id", "orderId", "reservationId", "ticketTypeId");

CREATE TABLE "PrimaryAdmissionTicket" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "ticketTypeId" TEXT NOT NULL,
  "unitNumber" INTEGER NOT NULL,
  "issuanceIdempotencyKey" TEXT NOT NULL,
  "status" "PrimaryAdmissionStatus" NOT NULL DEFAULT 'ISSUED',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryAdmissionTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryAdmissionTicket_unit_check" CHECK ("unitNumber" > 0),
  CONSTRAINT "PrimaryAdmissionTicket_void_check" CHECK (
    ("status" = 'ISSUED' AND "voidedAt" IS NULL AND "voidReason" IS NULL) OR
    ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND length(btrim("voidReason")) > 0)
  )
);

CREATE TABLE "PrimaryAdmissionCredential" (
  "id" TEXT NOT NULL,
  "admissionTicketId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL,
  "keyId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryAdmissionCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryAdmissionCredential_payload_check" CHECK (
    "payloadVersion" = 1 AND length("keyId") > 0 AND length("signature") > 0 AND
    "payloadDigest" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "PrimaryAdmissionTicket_orderId_unitNumber_key" ON "PrimaryAdmissionTicket"("orderId", "unitNumber");
CREATE UNIQUE INDEX "PrimaryAdmissionTicket_id_eventId_key" ON "PrimaryAdmissionTicket"("id", "eventId");
CREATE INDEX "PrimaryAdmissionTicket_organizerId_eventId_status_idx" ON "PrimaryAdmissionTicket"("organizerId", "eventId", "status");
CREATE INDEX "PrimaryAdmissionTicket_buyerUserId_createdAt_idx" ON "PrimaryAdmissionTicket"("buyerUserId", "createdAt");
CREATE UNIQUE INDEX "PrimaryAdmissionCredential_admissionTicketId_key" ON "PrimaryAdmissionCredential"("admissionTicketId");
CREATE UNIQUE INDEX "PrimaryAdmissionCredential_admissionTicketId_eventId_key" ON "PrimaryAdmissionCredential"("admissionTicketId", "eventId");
CREATE INDEX "PrimaryAdmissionCredential_eventId_keyId_idx" ON "PrimaryAdmissionCredential"("eventId", "keyId");

ALTER TABLE "PrimaryAdmissionTicket" ADD CONSTRAINT "PrimaryAdmissionTicket_order_scope_fkey"
FOREIGN KEY ("orderId", "organizerId", "eventId", "buyerUserId", "reservationId")
REFERENCES "PrimaryOrder"("id", "organizerId", "eventId", "buyerUserId", "reservationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryAdmissionTicket" ADD CONSTRAINT "PrimaryAdmissionTicket_line_scope_fkey"
FOREIGN KEY ("orderLineId", "orderId", "reservationId", "ticketTypeId")
REFERENCES "PrimaryOrderLine"("id", "orderId", "reservationId", "ticketTypeId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryAdmissionTicket" ADD CONSTRAINT "PrimaryAdmissionTicket_reservation_fkey"
FOREIGN KEY ("reservationId") REFERENCES "PrimaryInventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryAdmissionCredential" ADD CONSTRAINT "PrimaryAdmissionCredential_ticket_event_fkey"
FOREIGN KEY ("admissionTicketId", "eventId") REFERENCES "PrimaryAdmissionTicket"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_primary_admission_ticket()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PrimaryAdmissionTicket rows are append-only'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizerId" IS DISTINCT FROM OLD."organizerId"
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."buyerUserId" IS DISTINCT FROM OLD."buyerUserId"
    OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId" OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."orderLineId" IS DISTINCT FROM OLD."orderLineId" OR NEW."ticketTypeId" IS DISTINCT FROM OLD."ticketTypeId"
    OR NEW."unitNumber" IS DISTINCT FROM OLD."unitNumber" OR NEW."issuanceIdempotencyKey" IS DISTINCT FROM OLD."issuanceIdempotencyKey"
    OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'PrimaryAdmissionTicket issuance evidence is immutable';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'ISSUED' AND NEW."status" = 'VOIDED') THEN
    RAISE EXCEPTION 'Invalid PrimaryAdmissionTicket state transition';
  END IF;
  IF NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt" OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason" THEN
    IF NOT (OLD."status" = 'ISSUED' AND NEW."status" = 'VOIDED' AND OLD."voidedAt" IS NULL AND OLD."voidReason" IS NULL) THEN
      RAISE EXCEPTION 'Invalid PrimaryAdmissionTicket void metadata change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryAdmissionTicket_protected" BEFORE UPDATE OR DELETE ON "PrimaryAdmissionTicket"
FOR EACH ROW EXECUTE FUNCTION protect_primary_admission_ticket();

CREATE OR REPLACE FUNCTION reject_primary_admission_credential_change()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'PrimaryAdmissionCredential rows are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryAdmissionCredential_immutable" BEFORE UPDATE OR DELETE ON "PrimaryAdmissionCredential"
FOR EACH ROW EXECUTE FUNCTION reject_primary_admission_credential_change();
