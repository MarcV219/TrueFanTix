-- A valid subject alone is not sufficient delivery authorization. Without
-- binding the durable identity at insertion, a direct writer can reserve the
-- canonical unique idempotency key with a forged digest; the worker will
-- quarantine that row, but the application upsert will silently skip the
-- legitimate envelope. Preserve all legacy history and require every future
-- intent to carry the exact application identity for its locked subject.
BEGIN;

CREATE OR REPLACE FUNCTION transfer_proof_delivery_identity_window(
  delivery_kind TEXT,
  delivery_payload JSONB
)
RETURNS TEXT AS $$
DECLARE
  source_text TEXT;
  source_clock TIMESTAMP(3);
BEGIN
  IF delivery_kind = 'BUYER_CONFIRMATION_EMAIL' THEN
    source_text := delivery_payload ->> 'windowStart';
    IF JSONB_TYPEOF(delivery_payload -> 'windowStart') IS DISTINCT FROM 'string'
      OR source_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery window must be an exact ISO timestamp';
    END IF;
    source_clock := source_text::timestamptz AT TIME ZONE 'UTC';
    IF TO_CHAR(source_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> source_text
      OR MOD(FLOOR(EXTRACT(EPOCH FROM source_clock) * 1000)::bigint, 21600000) <> 0 THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery window must be normalized';
    END IF;
    RETURN source_text;
  ELSIF delivery_kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
    source_text := delivery_payload ->> 'completedAt';
    IF JSONB_TYPEOF(delivery_payload -> 'completedAt') IS DISTINCT FROM 'string'
      OR source_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery completion must be an exact ISO timestamp';
    END IF;
    source_clock := source_text::timestamptz AT TIME ZONE 'UTC';
    IF TO_CHAR(source_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> source_text THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery completion must be an exact ISO timestamp';
    END IF;
    RETURN TO_CHAR(
      TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM source_clock) / 21600) * 21600)
        AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
  END IF;
  RAISE EXCEPTION 'Unsupported transfer-proof delivery kind';
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION canonical_transfer_proof_delivery_envelope(
  delivery_order_id TEXT,
  delivery_kind TEXT,
  delivery_recipient TEXT,
  delivery_payload JSONB
)
RETURNS TEXT AS $$
DECLARE
  ticket_count_text TEXT;
  deadline_text TEXT;
  deadline_clock TIMESTAMP(3);
  payload_field_count INTEGER;
BEGIN
  IF JSONB_TYPEOF(delivery_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Transfer-proof delivery payload must be a canonical object';
  END IF;
  SELECT COUNT(*) INTO payload_field_count
  FROM JSONB_OBJECT_KEYS(delivery_payload);
  ticket_count_text := delivery_payload ->> 'ticketCount';
  IF JSONB_TYPEOF(delivery_payload -> 'ticketCount') IS DISTINCT FROM 'number'
    OR ticket_count_text !~ '^[1-9][0-9]*$'
    OR ticket_count_text::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Transfer-proof delivery ticket count must be a canonical safe integer';
  END IF;
  deadline_text := delivery_payload ->> 'deadline';
  IF JSONB_TYPEOF(delivery_payload -> 'deadline') IS DISTINCT FROM 'string'
    OR deadline_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION 'Transfer-proof delivery deadline must be an exact ISO timestamp';
  END IF;
  deadline_clock := deadline_text::timestamptz AT TIME ZONE 'UTC';
  IF TO_CHAR(deadline_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> deadline_text THEN
    RAISE EXCEPTION 'Transfer-proof delivery deadline must be an exact ISO timestamp';
  END IF;

  IF delivery_kind = 'BUYER_CONFIRMATION_EMAIL' THEN
    IF payload_field_count <> 4
      OR (
        JSONB_TYPEOF(delivery_payload -> 'buyerFirstName') IS DISTINCT FROM 'string'
        AND JSONB_TYPEOF(delivery_payload -> 'buyerFirstName') IS DISTINCT FROM 'null'
      )
      OR JSONB_TYPEOF(delivery_payload -> 'windowStart') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery payload must have the canonical shape';
    END IF;
    PERFORM transfer_proof_delivery_identity_window(delivery_kind, delivery_payload);
    RETURN
      '{"kind":' || TO_JSONB(delivery_kind)::text
      || ',"orderId":' || TO_JSONB(delivery_order_id)::text
      || ',"payloadJson":{"buyerFirstName":' || (delivery_payload -> 'buyerFirstName')::text
      || ',"deadline":' || (delivery_payload -> 'deadline')::text
      || ',"ticketCount":' || ticket_count_text
      || ',"windowStart":' || (delivery_payload -> 'windowStart')::text
      || '},"recipient":' || TO_JSONB(delivery_recipient)::text || '}';
  ELSIF delivery_kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
    IF payload_field_count <> 6
      OR JSONB_TYPEOF(delivery_payload -> 'sellerEmail') IS DISTINCT FROM 'string'
      OR NULLIF(BTRIM(delivery_payload ->> 'sellerEmail'), '') IS NULL
      OR (
        JSONB_TYPEOF(delivery_payload -> 'buyerEmail') IS DISTINCT FROM 'string'
        AND JSONB_TYPEOF(delivery_payload -> 'buyerEmail') IS DISTINCT FROM 'null'
      )
      OR JSONB_TYPEOF(delivery_payload -> 'transferProofType') IS DISTINCT FROM 'string'
      OR NULLIF(BTRIM(delivery_payload ->> 'transferProofType'), '') IS NULL
      OR JSONB_TYPEOF(delivery_payload -> 'completedAt') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery payload must have the canonical shape';
    END IF;
    PERFORM transfer_proof_delivery_identity_window(delivery_kind, delivery_payload);
    RETURN
      '{"kind":' || TO_JSONB(delivery_kind)::text
      || ',"orderId":' || TO_JSONB(delivery_order_id)::text
      || ',"payloadJson":{"buyerEmail":' || (delivery_payload -> 'buyerEmail')::text
      || ',"completedAt":' || (delivery_payload -> 'completedAt')::text
      || ',"deadline":' || (delivery_payload -> 'deadline')::text
      || ',"sellerEmail":' || (delivery_payload -> 'sellerEmail')::text
      || ',"ticketCount":' || ticket_count_text
      || ',"transferProofType":' || (delivery_payload -> 'transferProofType')::text
      || '},"recipient":' || TO_JSONB(delivery_recipient)::text || '}';
  END IF;
  RAISE EXCEPTION 'Unsupported transfer-proof delivery kind';
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Do not deploy a stricter INSERT contract over already-poisoned current
-- identities. Version-1 history remains explicitly grandfathered because its
-- provider key predates the full-envelope digest. A version-2 mismatch blocks
-- the migration for reviewed repair instead of leaving a canonical key held
-- by an envelope the application can never recreate.
DO $$
DECLARE
  delivery RECORD;
  expected_window TEXT;
  expected_key TEXT;
  expected_digest TEXT;
BEGIN
  FOR delivery IN
    SELECT id, "orderId", kind, recipient, "payloadJson", "idempotencyKey", "envelopeDigest"
    FROM "TransferProofDeliveryIntent"
    WHERE "identityVersion" = 2
    ORDER BY id
  LOOP
    expected_window := transfer_proof_delivery_identity_window(delivery.kind, delivery."payloadJson");
    expected_key := delivery."orderId" || ':' || expected_window || ':'
      || delivery.kind || ':' || delivery.recipient;
    expected_digest := ENCODE(SHA256(CONVERT_TO(
      canonical_transfer_proof_delivery_envelope(
        delivery."orderId", delivery.kind, delivery.recipient, delivery."payloadJson"
      ),
      'UTF8'
    )), 'hex');
    IF delivery."idempotencyKey" IS DISTINCT FROM expected_key
      OR delivery."envelopeDigest" IS DISTINCT FROM expected_digest THEN
      RAISE EXCEPTION 'Transfer-proof delivery identity preflight failed for row %', delivery.id;
    END IF;
  END LOOP;
END;
$$;

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
  identity_window_start TEXT;
  canonical_envelope TEXT;
  expected_idempotency_key TEXT;
  expected_envelope_digest TEXT;
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
    identity_window_start := transfer_proof_delivery_identity_window(
      NEW.kind,
      NEW."payloadJson"
    );
    IF NEW."payloadJson" IS DISTINCT FROM JSONB_BUILD_OBJECT(
      'buyerFirstName', expected_buyer_first_name,
      'ticketCount', expected_ticket_count,
      'deadline', expected_deadline,
      'windowStart', identity_window_start
    ) THEN
      RAISE EXCEPTION 'Transfer-proof buyer delivery payload must have the canonical shape';
    END IF;
    canonical_envelope := canonical_transfer_proof_delivery_envelope(
      NEW."orderId", NEW.kind, NEW.recipient, NEW."payloadJson"
    );
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
    identity_window_start := transfer_proof_delivery_identity_window(
      NEW.kind,
      NEW."payloadJson"
    );
    IF NEW."payloadJson" IS DISTINCT FROM JSONB_BUILD_OBJECT(
      'sellerEmail', expected_seller_email,
      'buyerEmail', expected_buyer_email,
      'ticketCount', expected_ticket_count,
      'transferProofType', transfer_proof_type,
      'deadline', expected_deadline,
      'completedAt', NEW."payloadJson" ->> 'completedAt'
    ) THEN
      RAISE EXCEPTION 'Transfer-proof administrator delivery payload must have the canonical shape';
    END IF;
    canonical_envelope := canonical_transfer_proof_delivery_envelope(
      NEW."orderId", NEW.kind, NEW.recipient, NEW."payloadJson"
    );
  ELSE
    RAISE EXCEPTION 'Unsupported transfer-proof delivery kind';
  END IF;

  expected_idempotency_key := NEW."orderId" || ':' || identity_window_start
    || ':' || NEW.kind || ':' || NEW.recipient;
  IF NEW."idempotencyKey" IS DISTINCT FROM expected_idempotency_key THEN
    RAISE EXCEPTION 'Transfer-proof delivery idempotency key must match its canonical envelope';
  END IF;

  expected_envelope_digest := ENCODE(
    SHA256(CONVERT_TO(canonical_envelope, 'UTF8')),
    'hex'
  );
  IF NEW."identityVersion" IS DISTINCT FROM 2
    OR NEW."envelopeDigest" IS DISTINCT FROM expected_envelope_digest THEN
    RAISE EXCEPTION 'Transfer-proof delivery digest must match its canonical envelope';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The existing INSERT trigger now executes this stricter function. Existing
-- rows are deliberately not rewritten or reinterpreted.
COMMIT;
