-- A delivery envelope must describe the transfer-proof workflow of the Order
-- it references, not merely an arbitrary existing Order. Preserve every
-- immutable legacy row, but authorize each future intent from the locked
-- transfer-proof state and participant snapshot.
CREATE OR REPLACE FUNCTION require_transfer_proof_delivery_subject()
RETURNS trigger AS $$
DECLARE
  order_status TEXT;
  buyer_confirmation_status TEXT;
  transfer_proof_type TEXT;
  transfer_proof_data TEXT;
  transfer_verification_status TEXT;
  dispute_window_ends_at TIMESTAMP(3);
  seller_id TEXT;
  buyer_seller_id TEXT;
  expected_seller_email TEXT;
  expected_buyer_email TEXT;
  expected_buyer_first_name TEXT;
  expected_ticket_count BIGINT;
  expected_deadline TEXT;
  payload_ticket_count TEXT;
BEGIN
  SELECT
    parent_order.status::text,
    parent_order."buyerConfirmationStatus",
    parent_order."transferProofType",
    parent_order."transferProofData",
    parent_order."transferVerificationStatus",
    parent_order."disputeWindowEndsAt",
    parent_order."sellerId",
    parent_order."buyerSellerId"
  INTO
    order_status,
    buyer_confirmation_status,
    transfer_proof_type,
    transfer_proof_data,
    transfer_verification_status,
    dispute_window_ends_at,
    seller_id,
    buyer_seller_id
  FROM "Order" parent_order
  WHERE parent_order.id = NEW."orderId"
  FOR UPDATE;

  IF NOT FOUND OR (
    order_status = 'PAID'
    AND buyer_confirmation_status = 'PENDING'
    AND NULLIF(BTRIM(transfer_proof_type), '') IS NOT NULL
    AND NULLIF(BTRIM(transfer_proof_data), '') IS NOT NULL
    AND transfer_verification_status = 'PENDING'
    AND dispute_window_ends_at IS NOT NULL
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Transfer-proof delivery requires an eligible paid transfer-proof order';
  END IF;

  SELECT buyer_user.email, buyer_user."firstName"
  INTO expected_buyer_email, expected_buyer_first_name
  FROM "User" buyer_user
  WHERE buyer_user."sellerId" = buyer_seller_id
  FOR SHARE;

  -- The parent UPDATE lock blocks new child foreign-key references while the
  -- row locks below prevent the current item set from being deleted or
  -- reparented before its count is authorized.
  PERFORM order_item.id
  FROM "OrderItem" order_item
  WHERE order_item."orderId" = NEW."orderId"
  ORDER BY order_item.id
  FOR SHARE;

  SELECT COUNT(*)
  INTO expected_ticket_count
  FROM "OrderItem" order_item
  WHERE order_item."orderId" = NEW."orderId";

  IF expected_ticket_count < 1 THEN
    RAISE EXCEPTION 'Transfer-proof delivery requires at least one order ticket';
  END IF;

  expected_deadline := TO_CHAR(
    dispute_window_ends_at,
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  payload_ticket_count := NEW."payloadJson" ->> 'ticketCount';

  IF (
    JSONB_TYPEOF(NEW."payloadJson" -> 'ticketCount') = 'number'
    AND payload_ticket_count ~ '^[1-9][0-9]*$'
    AND payload_ticket_count::numeric = expected_ticket_count
    AND NEW."payloadJson" ->> 'deadline' = expected_deadline
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Transfer-proof delivery payload must match the order ticket count and deadline';
  END IF;

  IF NEW.kind = 'BUYER_CONFIRMATION_EMAIL' THEN
    IF expected_buyer_email IS NULL
      OR NEW.recipient IS DISTINCT FROM expected_buyer_email THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery recipient must match the order buyer';
    END IF;
    IF NEW."payloadJson" ->> 'buyerFirstName' IS DISTINCT FROM expected_buyer_first_name THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery payload must match the order buyer';
    END IF;
  ELSIF NEW.kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
    SELECT seller_user.email
    INTO expected_seller_email
    FROM "User" seller_user
    WHERE seller_user."sellerId" = seller_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transfer-proof delivery requires the order seller identity';
    END IF;

    IF NEW.recipient IS DISTINCT FROM 'admin@truefantix.com' THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery recipient must match the activity mailbox';
    END IF;
    IF (
      NEW."payloadJson" ->> 'sellerEmail' = expected_seller_email
      AND NEW."payloadJson" ->> 'buyerEmail' IS NOT DISTINCT FROM expected_buyer_email
      AND NEW."payloadJson" ->> 'transferProofType' = transfer_proof_type
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery payload must match the order participants and proof';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported transfer-proof delivery kind';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- `completedAt` and the buyer delivery `windowStart` remain immutable,
-- digest-bound envelope metadata. The legacy Order stores review time inside
-- an opaque proof blob rather than a structured column, so this migration does
-- not infer either clock from that application JSON. Deadline, ticket count,
-- proof type, participants, kind, and recipient are all bound here.

CREATE TRIGGER "TransferProofDeliveryIntent_order_subject_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION require_transfer_proof_delivery_subject();
