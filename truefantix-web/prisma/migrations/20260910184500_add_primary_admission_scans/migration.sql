ALTER TYPE "PrimaryAdmissionStatus" ADD VALUE 'CHECKED_IN';

CREATE TYPE "PrimaryAdmissionScanResult" AS ENUM (
  'ACCEPTED', 'DUPLICATE', 'VOIDED', 'WRONG_EVENT', 'UNKNOWN_CREDENTIAL',
  'INVALID_CREDENTIAL', 'UNSUPPORTED_KEY', 'UNSUPPORTED_VERSION'
);

ALTER TABLE "PrimaryAdmissionTicket" DROP CONSTRAINT "PrimaryAdmissionTicket_void_check";
ALTER TABLE "PrimaryAdmissionTicket" ADD CONSTRAINT "PrimaryAdmissionTicket_void_check" CHECK (
  ("status" IN ('ISSUED', 'CHECKED_IN') AND "voidedAt" IS NULL AND "voidReason" IS NULL) OR
  ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND length(btrim("voidReason")) > 0)
);

CREATE UNIQUE INDEX "PrimaryAdmissionCredential_id_eventId_key"
ON "PrimaryAdmissionCredential"("id", "eventId");
CREATE UNIQUE INDEX "PrimaryAdmissionCredential_id_admissionTicketId_eventId_key"
ON "PrimaryAdmissionCredential"("id", "admissionTicketId", "eventId");

CREATE TABLE "PrimaryAdmissionScan" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "admissionTicketId" TEXT,
  "credentialId" TEXT,
  "operatorUserId" TEXT NOT NULL,
  "result" "PrimaryAdmissionScanResult" NOT NULL,
  "deviceId" TEXT,
  "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryAdmissionScan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrimaryAdmissionScan_device_check" CHECK (
    "deviceId" IS NULL OR (length("deviceId") BETWEEN 1 AND 64 AND "deviceId" ~ '^[A-Za-z0-9._:-]+$')
  ),
  CONSTRAINT "PrimaryAdmissionScan_binding_check" CHECK (
    ("admissionTicketId" IS NULL AND "credentialId" IS NULL) OR
    ("admissionTicketId" IS NOT NULL AND "credentialId" IS NOT NULL)
  )
);

CREATE INDEX "PrimaryAdmissionScan_organizerId_eventId_scannedAt_idx" ON "PrimaryAdmissionScan"("organizerId", "eventId", "scannedAt");
CREATE INDEX "PrimaryAdmissionScan_admissionTicketId_scannedAt_idx" ON "PrimaryAdmissionScan"("admissionTicketId", "scannedAt");
CREATE INDEX "PrimaryAdmissionScan_operatorUserId_scannedAt_idx" ON "PrimaryAdmissionScan"("operatorUserId", "scannedAt");
ALTER TABLE "PrimaryAdmissionScan" ADD CONSTRAINT "PrimaryAdmissionScan_event_scope_fkey"
FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryAdmissionScan" ADD CONSTRAINT "PrimaryAdmissionScan_ticket_event_fkey"
FOREIGN KEY ("admissionTicketId", "eventId") REFERENCES "PrimaryAdmissionTicket"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryAdmissionScan" ADD CONSTRAINT "PrimaryAdmissionScan_credential_event_fkey"
FOREIGN KEY ("credentialId", "admissionTicketId", "eventId") REFERENCES "PrimaryAdmissionCredential"("id", "admissionTicketId", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryAdmissionScan" ADD CONSTRAINT "PrimaryAdmissionScan_operator_fkey"
FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (OLD."status" = 'ISSUED' AND NEW."status" IN ('VOIDED', 'CHECKED_IN')) THEN
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

CREATE OR REPLACE FUNCTION reject_primary_admission_scan_change()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'PrimaryAdmissionScan rows are append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryAdmissionScan_append_only" BEFORE UPDATE OR DELETE ON "PrimaryAdmissionScan"
FOR EACH ROW EXECUTE FUNCTION reject_primary_admission_scan_change();
