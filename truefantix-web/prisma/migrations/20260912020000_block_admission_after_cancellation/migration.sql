CREATE OR REPLACE FUNCTION lock_primary_cancellation_admission_gate()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'REQUESTED' AND NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."eventId", 746836292));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_primary_cancellation_requested_insert()
RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'REQUESTED' OR NEW."activatedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Event cancellation must begin in REQUESTED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryEventCancellation_requested_insert"
BEFORE INSERT ON "PrimaryEventCancellation"
FOR EACH ROW EXECUTE FUNCTION require_primary_cancellation_requested_insert();

CREATE TRIGGER "PrimaryEventCancellation_admission_gate_lock"
BEFORE UPDATE ON "PrimaryEventCancellation"
FOR EACH ROW EXECUTE FUNCTION lock_primary_cancellation_admission_gate();

CREATE OR REPLACE FUNCTION reject_primary_check_in_after_cancellation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ISSUED' AND NEW.status = 'CHECKED_IN' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."eventId", 746836292));
    IF EXISTS (
      SELECT 1
      FROM "PrimaryEventCancellation"
      WHERE "eventId" = NEW."eventId" AND status <> 'REQUESTED'
    ) THEN
      RAISE EXCEPTION 'Admission is blocked by event cancellation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrimaryAdmissionTicket_cancellation_gate"
BEFORE UPDATE ON "PrimaryAdmissionTicket"
FOR EACH ROW EXECUTE FUNCTION reject_primary_check_in_after_cancellation();

CREATE OR REPLACE FUNCTION validate_primary_admission_scan_insert()
RETURNS trigger AS $$
DECLARE
  ticket_status "PrimaryAdmissionStatus";
  accepted_exists BOOLEAN;
  cancellation_blocks_admission BOOLEAN;
BEGIN
  IF NEW."result" IN ('ACCEPTED', 'DUPLICATE', 'VOIDED') THEN
    IF NEW."admissionTicketId" IS NULL OR NEW."credentialId" IS NULL THEN
      RAISE EXCEPTION 'Bound admission scan result requires exact ticket and credential evidence';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."eventId", 746836292));
    SELECT "status" INTO ticket_status
    FROM "PrimaryAdmissionTicket"
    WHERE "id" = NEW."admissionTicketId" AND "eventId" = NEW."eventId"
    FOR SHARE;
    SELECT EXISTS (
      SELECT 1
      FROM "PrimaryEventCancellation"
      WHERE "eventId" = NEW."eventId" AND status <> 'REQUESTED'
    ) INTO cancellation_blocks_admission;
    IF NEW."result" = 'ACCEPTED' AND cancellation_blocks_admission THEN
      RAISE EXCEPTION 'Admission is blocked by event cancellation';
    END IF;
    IF NEW."result" IN ('ACCEPTED', 'DUPLICATE') AND ticket_status IS DISTINCT FROM 'CHECKED_IN'::"PrimaryAdmissionStatus" THEN
      RAISE EXCEPTION 'Accepted or duplicate scan requires a checked-in ticket';
    END IF;
    IF NEW."result" = 'VOIDED'
      AND ticket_status IS DISTINCT FROM 'VOIDED'::"PrimaryAdmissionStatus"
      AND NOT cancellation_blocks_admission THEN
      RAISE EXCEPTION 'Voided scan requires a voided ticket or active cancellation';
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
