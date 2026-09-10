ALTER TABLE "PrimaryAdmissionScan"
ADD COLUMN "requestId" TEXT,
ADD COLUMN "commandDigest" TEXT;

-- The foundation database is synthetic-only and the preceding migration has
-- not been applied outside disposable review databases. This defensive fill
-- keeps a sequential migration deploy valid if a disposable database contains
-- pre-revision scan fixtures.
UPDATE "PrimaryAdmissionScan"
SET "requestId" = 'migration-' || "id",
    "commandDigest" = encode(sha256(convert_to('migration-' || "id", 'UTF8')), 'hex')
WHERE "requestId" IS NULL;

ALTER TABLE "PrimaryAdmissionScan"
ALTER COLUMN "requestId" SET NOT NULL,
ALTER COLUMN "commandDigest" SET NOT NULL,
ADD CONSTRAINT "PrimaryAdmissionScan_request_check" CHECK ("requestId" ~ '^[A-Za-z0-9._:-]{1,128}$'),
ADD CONSTRAINT "PrimaryAdmissionScan_command_digest_check" CHECK ("commandDigest" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "PrimaryAdmissionScan_requestId_key" ON "PrimaryAdmissionScan"("requestId");

DROP TRIGGER "PrimaryAdmissionScan_append_only" ON "PrimaryAdmissionScan";

CREATE OR REPLACE FUNCTION validate_primary_admission_scan_insert()
RETURNS trigger AS $$
DECLARE
  ticket_status "PrimaryAdmissionStatus";
BEGIN
  IF NEW."result" IN ('ACCEPTED', 'DUPLICATE', 'VOIDED') THEN
    IF NEW."admissionTicketId" IS NULL OR NEW."credentialId" IS NULL THEN
      RAISE EXCEPTION 'Bound admission scan result requires exact ticket and credential evidence';
    END IF;
    SELECT "status" INTO ticket_status
    FROM "PrimaryAdmissionTicket"
    WHERE "id" = NEW."admissionTicketId" AND "eventId" = NEW."eventId"
    FOR SHARE;
    IF NEW."result" IN ('ACCEPTED', 'DUPLICATE') AND ticket_status IS DISTINCT FROM 'CHECKED_IN'::"PrimaryAdmissionStatus" THEN
      RAISE EXCEPTION 'Accepted or duplicate scan requires a checked-in ticket';
    END IF;
    IF NEW."result" = 'VOIDED' AND ticket_status IS DISTINCT FROM 'VOIDED'::"PrimaryAdmissionStatus" THEN
      RAISE EXCEPTION 'Voided scan requires a voided ticket';
    END IF;
  ELSE
    IF NEW."admissionTicketId" IS NOT NULL OR NEW."credentialId" IS NOT NULL THEN
      RAISE EXCEPTION 'Unbound admission scan result cannot name ticket or credential evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryAdmissionScan_consistent" BEFORE INSERT ON "PrimaryAdmissionScan"
FOR EACH ROW EXECUTE FUNCTION validate_primary_admission_scan_insert();

CREATE TRIGGER "PrimaryAdmissionScan_append_only" BEFORE UPDATE OR DELETE ON "PrimaryAdmissionScan"
FOR EACH ROW EXECUTE FUNCTION reject_primary_admission_scan_change();
