-- The delivery envelope must use the accepted proof's durable order clock,
-- not a second caller-selected timestamp. The existing order model records
-- the 24-hour buyer confirmation deadline, so the accepted proof clock is the
-- exact deadline minus 24 hours and the delivery identity window is its
-- normalized six-hour bucket.
BEGIN;

-- Serialize the preflight with all delivery-history writers. Without this
-- lock, an invalid version-2 insert could commit after the scan but before the
-- enforcing trigger exists. Reads remain available throughout the upgrade.
LOCK TABLE "TransferProofDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION transfer_proof_delivery_authoritative_completed_at(
  delivery_deadline TIMESTAMP(3)
)
RETURNS TEXT AS $$
BEGIN
  IF delivery_deadline IS NULL THEN
    RAISE EXCEPTION 'Transfer-proof delivery requires an authoritative order deadline';
  END IF;
  RETURN TO_CHAR(
    delivery_deadline - INTERVAL '24 hours',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION transfer_proof_delivery_authoritative_window(
  delivery_deadline TIMESTAMP(3)
)
RETURNS TEXT AS $$
DECLARE
  completed_clock TIMESTAMP(3);
BEGIN
  IF delivery_deadline IS NULL THEN
    RAISE EXCEPTION 'Transfer-proof delivery requires an authoritative order deadline';
  END IF;
  completed_clock := delivery_deadline - INTERVAL '24 hours';
  RETURN TO_CHAR(
    TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM completed_clock) / 21600) * 21600)
      AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Version-2 rows claim that their complete delivery envelope is canonical.
-- Fail the entire upgrade if any such history used a caller-selected clock;
-- version-1 provider history remains grandfathered and byte-for-byte intact.
DO $$
DECLARE
  delivery RECORD;
  expected_clock TEXT;
BEGIN
  FOR delivery IN
    SELECT
      intent.id,
      intent.kind,
      intent."payloadJson",
      parent_order."disputeWindowEndsAt"
    FROM "TransferProofDeliveryIntent" intent
    LEFT JOIN "Order" parent_order ON parent_order.id = intent."orderId"
    WHERE intent."identityVersion" = 2
    ORDER BY intent.id
  LOOP
    IF delivery."disputeWindowEndsAt" IS NULL THEN
      RAISE EXCEPTION 'Transfer-proof delivery clock preflight failed for row %', delivery.id;
    END IF;
    IF delivery.kind = 'BUYER_CONFIRMATION_EMAIL' THEN
      expected_clock := transfer_proof_delivery_authoritative_window(
        delivery."disputeWindowEndsAt"
      );
      IF delivery."payloadJson" ->> 'windowStart' IS DISTINCT FROM expected_clock THEN
        RAISE EXCEPTION 'Transfer-proof delivery clock preflight failed for row %', delivery.id;
      END IF;
    ELSIF delivery.kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
      expected_clock := transfer_proof_delivery_authoritative_completed_at(
        delivery."disputeWindowEndsAt"
      );
      IF delivery."payloadJson" ->> 'completedAt' IS DISTINCT FROM expected_clock THEN
        RAISE EXCEPTION 'Transfer-proof delivery clock preflight failed for row %', delivery.id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Transfer-proof delivery clock preflight failed for row %', delivery.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION require_transfer_proof_delivery_authoritative_clock()
RETURNS trigger AS $$
DECLARE
  order_deadline TIMESTAMP(3);
  expected_clock TEXT;
BEGIN
  SELECT parent_order."disputeWindowEndsAt"
  INTO order_deadline
  FROM "Order" parent_order
  WHERE parent_order.id = NEW."orderId"
  FOR UPDATE;

  IF NOT FOUND OR order_deadline IS NULL THEN
    RAISE EXCEPTION 'Transfer-proof delivery requires an authoritative order deadline';
  END IF;

  IF NEW.kind = 'BUYER_CONFIRMATION_EMAIL' THEN
    expected_clock := transfer_proof_delivery_authoritative_window(order_deadline);
    IF NEW."payloadJson" ->> 'windowStart' IS DISTINCT FROM expected_clock THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery window must match the order transfer clock';
    END IF;
  ELSIF NEW.kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
    expected_clock := transfer_proof_delivery_authoritative_completed_at(order_deadline);
    IF NEW."payloadJson" ->> 'completedAt' IS DISTINCT FROM expected_clock THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery completion must match the order transfer clock';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported transfer-proof delivery kind';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- PostgreSQL fires same-event triggers by name. Run after the established
-- order-subject/identity trigger so its lock order and specific authorization
-- failures remain stable, then enforce this successor clock invariant.
CREATE TRIGGER "TransferProofDeliveryIntent_z_order_clock_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION require_transfer_proof_delivery_authoritative_clock();

COMMIT;
