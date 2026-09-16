-- Delivery evidence may continue arriving after a recipient replies. Advance
-- the selected delivery provenance without hiding the later reply lifecycle.
CREATE OR REPLACE FUNCTION protect_outreach_delivery_status_provenance()
RETURNS trigger AS $$
DECLARE
  selected_type TEXT;
  selected_occurred_at TIMESTAMP(3);
  selected_detail TEXT;
  expected_priority INTEGER;
  expected_status TEXT;
  legacy_priority INTEGER;
  preserves_reply BOOLEAN;
BEGIN
  IF NEW."deliveryStatusPriority" IS NOT DISTINCT FROM OLD."deliveryStatusPriority"
    AND NEW."deliveryStatusOccurredAt" IS NOT DISTINCT FROM OLD."deliveryStatusOccurredAt"
    AND NEW."deliveryStatusSvixId" IS NOT DISTINCT FROM OLD."deliveryStatusSvixId" THEN
    IF OLD."deliveryStatusPriority" IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.error IS NOT DISTINCT FROM OLD.error THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'REPLIED'
      AND NEW."repliedAt" IS NOT NULL
      AND NEW.error IS NOT DISTINCT FROM OLD.error THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Outreach status and error cannot change without advancing delivery provenance';
  END IF;

  IF NEW."deliveryStatusPriority" IS NULL
    OR NEW."deliveryStatusOccurredAt" IS NULL
    OR NEW."deliveryStatusSvixId" IS NULL THEN
    RAISE EXCEPTION 'Outreach delivery status provenance cannot be partial or cleared';
  END IF;

  SELECT "type", "occurredAt", "detail"
  INTO selected_type, selected_occurred_at, selected_detail
  FROM "OutreachEmailEvent"
  WHERE "svixId" = NEW."deliveryStatusSvixId"
    AND "recipientId" = NEW."id";

  IF NOT FOUND OR selected_occurred_at IS DISTINCT FROM NEW."deliveryStatusOccurredAt" THEN
    RAISE EXCEPTION 'Outreach delivery status provenance must reference exact persisted event evidence';
  END IF;

  expected_priority := CASE selected_type
    WHEN 'email.sent' THEN 1
    WHEN 'email.delivery_delayed' THEN 2
    WHEN 'email.delivered' THEN 3
    WHEN 'email.failed' THEN 3
    WHEN 'email.bounced' THEN 4
    WHEN 'email.suppressed' THEN 4
    WHEN 'email.complained' THEN 5
    ELSE NULL
  END;
  expected_status := CASE selected_type
    WHEN 'email.sent' THEN 'SENT'
    WHEN 'email.delivery_delayed' THEN 'DELIVERY_DELAYED'
    WHEN 'email.delivered' THEN 'DELIVERED'
    WHEN 'email.failed' THEN 'FAILED'
    WHEN 'email.bounced' THEN 'BOUNCED'
    WHEN 'email.suppressed' THEN 'SUPPRESSED'
    WHEN 'email.complained' THEN 'COMPLAINED'
    ELSE NULL
  END;
  preserves_reply := OLD.status = 'REPLIED'
    AND OLD."repliedAt" IS NOT NULL
    AND NEW.status = 'REPLIED'
    AND NEW."repliedAt" IS NOT DISTINCT FROM OLD."repliedAt";

  IF expected_priority IS NULL
    OR NEW."deliveryStatusPriority" IS DISTINCT FROM expected_priority
    OR (NEW.status IS DISTINCT FROM expected_status AND NOT preserves_reply)
    OR NEW.error IS DISTINCT FROM selected_detail THEN
    RAISE EXCEPTION 'Outreach delivery status projection must match selected event evidence';
  END IF;

  IF OLD."deliveryStatusPriority" IS NULL THEN
    legacy_priority := CASE OLD.status
      WHEN 'SENT' THEN 1
      WHEN 'DELIVERY_DELAYED' THEN 2
      WHEN 'DELIVERED' THEN 3
      WHEN 'FAILED' THEN 3
      WHEN 'BOUNCED' THEN 4
      WHEN 'SUPPRESSED' THEN 4
      WHEN 'COMPLAINED' THEN 5
      ELSE 0
    END;
    IF NEW."deliveryStatusPriority" <= legacy_priority THEN
      RAISE EXCEPTION 'Legacy outreach delivery status is authoritative at equal or lower priority';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    NEW."deliveryStatusPriority" > OLD."deliveryStatusPriority"
    OR (
      NEW."deliveryStatusPriority" = OLD."deliveryStatusPriority"
      AND NEW."deliveryStatusOccurredAt" > OLD."deliveryStatusOccurredAt"
    )
    OR (
      NEW."deliveryStatusPriority" = OLD."deliveryStatusPriority"
      AND NEW."deliveryStatusOccurredAt" = OLD."deliveryStatusOccurredAt"
      AND NEW."deliveryStatusSvixId" COLLATE "C" > OLD."deliveryStatusSvixId" COLLATE "C"
    )
  ) THEN
    RAISE EXCEPTION 'Outreach delivery status provenance must advance deterministically';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
