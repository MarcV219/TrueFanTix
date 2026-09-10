CREATE UNIQUE INDEX "PrimaryAdmissionScan_one_accepted_per_ticket"
ON "PrimaryAdmissionScan"("admissionTicketId")
WHERE "result" = 'ACCEPTED';

CREATE OR REPLACE FUNCTION validate_primary_admission_scan_insert()
RETURNS trigger AS $$
DECLARE
  ticket_status "PrimaryAdmissionStatus";
  accepted_exists BOOLEAN;
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
    IF NEW."result" = 'DUPLICATE' THEN
      SELECT EXISTS (
        SELECT 1 FROM "PrimaryAdmissionScan"
        WHERE "result" = 'ACCEPTED'
          AND "admissionTicketId" = NEW."admissionTicketId"
          AND "credentialId" = NEW."credentialId"
          AND "eventId" = NEW."eventId"
      ) INTO accepted_exists;
      IF NOT accepted_exists THEN
        RAISE EXCEPTION 'Duplicate scan requires prior accepted evidence for the exact credential';
      END IF;
    END IF;
  ELSE
    IF NEW."admissionTicketId" IS NOT NULL OR NEW."credentialId" IS NOT NULL THEN
      RAISE EXCEPTION 'Unbound admission scan result cannot name ticket or credential evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
