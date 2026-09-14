-- Version-2 transfer-proof delivery intents are immutable authorization
-- snapshots. Bind the reverse direction as well: once such a snapshot exists,
-- its parent participants, proof kind, deadline, and item membership may not
-- drift underneath pending or historical delivery evidence.
BEGIN;

-- The application route owns the Order before inserting an intent. Take the
-- parent and item tables first so an already-running route can finish its
-- insert rather than deadlock against this deployment. A direct intent writer
-- requests only ROW SHARE on Order from its authorization trigger, which is
-- compatible with this lock, so it can also finish before the intent lock is
-- acquired.
LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "OrderItem" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "TransferProofDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  delivery RECORD;
  expected_deadline TEXT;
  payload_ticket_count TEXT;
BEGIN
  FOR delivery IN
    SELECT
      intent.id,
      intent.kind,
      intent.recipient,
      intent.status,
      intent."payloadJson",
      parent_order."transferProofType",
      parent_order."disputeWindowEndsAt",
      seller_user.email AS seller_email,
      buyer_user.email AS buyer_email,
      buyer_user."firstName" AS buyer_first_name,
      (
        SELECT COUNT(*)
        FROM "OrderItem" order_item
        WHERE order_item."orderId" = intent."orderId"
      ) AS ticket_count
    FROM "TransferProofDeliveryIntent" intent
    LEFT JOIN "Order" parent_order ON parent_order.id = intent."orderId"
    LEFT JOIN "User" seller_user ON seller_user."sellerId" = parent_order."sellerId"
    LEFT JOIN "User" buyer_user ON buyer_user."sellerId" = parent_order."buyerSellerId"
    WHERE intent."identityVersion" = 2
    ORDER BY intent.id
  LOOP
    IF delivery."disputeWindowEndsAt" IS NULL OR delivery.ticket_count < 1 THEN
      RAISE EXCEPTION 'Transfer-proof order snapshot preflight failed for row %', delivery.id;
    END IF;

    expected_deadline := TO_CHAR(
      delivery."disputeWindowEndsAt",
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    payload_ticket_count := delivery."payloadJson" ->> 'ticketCount';

    IF JSONB_TYPEOF(delivery."payloadJson" -> 'ticketCount') IS DISTINCT FROM 'number'
      OR payload_ticket_count !~ '^[1-9][0-9]*$'
      OR payload_ticket_count::numeric <> delivery.ticket_count
      OR delivery."payloadJson" ->> 'deadline' IS DISTINCT FROM expected_deadline THEN
      RAISE EXCEPTION 'Transfer-proof order snapshot preflight failed for row %', delivery.id;
    END IF;

    IF delivery.kind = 'BUYER_CONFIRMATION_EMAIL' THEN
      IF delivery.status IN ('PENDING', 'PROCESSING', 'FAILED') AND (
        delivery.buyer_email IS NULL
        OR delivery.recipient IS DISTINCT FROM delivery.buyer_email
        OR delivery."payloadJson" ->> 'buyerFirstName' IS DISTINCT FROM delivery.buyer_first_name
      ) THEN
        RAISE EXCEPTION 'Transfer-proof order snapshot preflight failed for row %', delivery.id;
      END IF;
    ELSIF delivery.kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
      IF delivery.recipient IS DISTINCT FROM 'admin@truefantix.com'
        OR delivery."payloadJson" ->> 'transferProofType' IS DISTINCT FROM delivery."transferProofType"
        OR (
          delivery.status IN ('PENDING', 'PROCESSING', 'FAILED')
          AND (
            delivery.seller_email IS NULL
            OR delivery."payloadJson" ->> 'sellerEmail' IS DISTINCT FROM delivery.seller_email
            OR delivery."payloadJson" ->> 'buyerEmail' IS DISTINCT FROM delivery.buyer_email
          )
        ) THEN
        RAISE EXCEPTION 'Transfer-proof order snapshot preflight failed for row %', delivery.id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Transfer-proof order snapshot preflight failed for row %', delivery.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION protect_transfer_proof_order_snapshot()
RETURNS trigger AS $$
BEGIN
  IF (
    OLD."sellerId" IS DISTINCT FROM NEW."sellerId"
    OR OLD."buyerSellerId" IS DISTINCT FROM NEW."buyerSellerId"
    OR OLD."transferProofType" IS DISTINCT FROM NEW."transferProofType"
    OR OLD."disputeWindowEndsAt" IS DISTINCT FROM NEW."disputeWindowEndsAt"
  ) AND EXISTS (
    SELECT 1
    FROM "TransferProofDeliveryIntent" intent
    WHERE intent."orderId" = OLD.id
      AND intent."identityVersion" = 2
  ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery order snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_transfer_proof_snapshot_update"
BEFORE UPDATE OF "sellerId", "buyerSellerId", "transferProofType", "disputeWindowEndsAt"
ON "Order"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_order_snapshot();

CREATE OR REPLACE FUNCTION protect_active_transfer_proof_participant_snapshot()
RETURNS trigger AS $$
DECLARE
  prior_seller_id TEXT;
  next_seller_id TEXT;
BEGIN
  prior_seller_id := OLD."sellerId";
  next_seller_id := NEW."sellerId";

  IF OLD."sellerId" IS DISTINCT FROM NEW."sellerId" AND EXISTS (
    SELECT 1
    FROM "Order" parent_order
    JOIN "TransferProofDeliveryIntent" intent
      ON intent."orderId" = parent_order.id
    WHERE intent."identityVersion" = 2
      AND intent.status IN ('PENDING', 'PROCESSING', 'FAILED')
      AND (
        parent_order."sellerId" IN (prior_seller_id, next_seller_id)
        OR parent_order."buyerSellerId" IN (prior_seller_id, next_seller_id)
      )
  ) THEN
    RAISE EXCEPTION 'Active transfer-proof delivery participant identity is immutable';
  END IF;

  IF OLD.email IS DISTINCT FROM NEW.email AND EXISTS (
    SELECT 1
    FROM "Order" parent_order
    JOIN "TransferProofDeliveryIntent" intent
      ON intent."orderId" = parent_order.id
    WHERE intent."identityVersion" = 2
      AND intent.status IN ('PENDING', 'PROCESSING', 'FAILED')
      AND (
        parent_order."sellerId" = prior_seller_id
        OR parent_order."buyerSellerId" = prior_seller_id
      )
  ) THEN
    RAISE EXCEPTION 'Active transfer-proof delivery participant email is immutable';
  END IF;

  IF OLD."firstName" IS DISTINCT FROM NEW."firstName" AND EXISTS (
    SELECT 1
    FROM "Order" parent_order
    JOIN "TransferProofDeliveryIntent" intent
      ON intent."orderId" = parent_order.id
    WHERE intent."identityVersion" = 2
      AND intent.status IN ('PENDING', 'PROCESSING', 'FAILED')
      AND intent.kind = 'BUYER_CONFIRMATION_EMAIL'
      AND parent_order."buyerSellerId" = prior_seller_id
  ) THEN
    RAISE EXCEPTION 'Active transfer-proof delivery buyer name is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_active_transfer_proof_participant_snapshot"
BEFORE UPDATE OF email, "firstName", "sellerId" ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_active_transfer_proof_participant_snapshot();

CREATE OR REPLACE FUNCTION protect_transfer_proof_order_item_membership()
RETURNS trigger AS $$
DECLARE
  prior_order_id TEXT;
  next_order_id TEXT;
BEGIN
  prior_order_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD."orderId" ELSE NULL END;
  next_order_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW."orderId" ELSE NULL END;

  IF TG_OP = 'UPDATE' AND prior_order_id IS NOT DISTINCT FROM next_order_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "TransferProofDeliveryIntent" intent
    WHERE intent."identityVersion" = 2
      AND intent."orderId" IN (prior_order_id, next_order_id)
  ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery order item membership is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderItem_transfer_proof_snapshot_membership"
BEFORE INSERT OR UPDATE OF "orderId" OR DELETE ON "OrderItem"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_order_item_membership();

COMMIT;
