-- Migration 94 could prove the review request identity but could not
-- authenticate its rendered support-email content. Because those historical
-- bodies did not retain authoritative render inputs, fail closed rather than
-- grandfathering an unverifiable envelope. The approved isolated staging lane
-- has no real review rows; any row must be reconciled before this upgrade.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TransferProofReviewDeliveryIntent") THEN
    RAISE EXCEPTION 'Transfer-proof review envelope preflight requires an empty reconciled outbox';
  END IF;
END;
$$;

ALTER TABLE "TransferProofReviewDeliveryIntent"
  ADD COLUMN "payloadJson" JSONB,
  ADD COLUMN "envelopeDigest" TEXT;

ALTER TABLE "TransferProofReviewDeliveryIntent"
  ALTER COLUMN "payloadJson" SET NOT NULL,
  ALTER COLUMN "envelopeDigest" SET NOT NULL,
  ADD CONSTRAINT "TransferProofReviewDeliveryIntent_payload_check"
    CHECK (
      JSONB_TYPEOF("payloadJson") = 'object'
      AND "payloadJson" ?& ARRAY['sellerName', 'sellerEmail', 'eventTitle', 'appOrigin']
      AND JSONB_TYPEOF("payloadJson" -> 'sellerName') = 'string'
      AND JSONB_TYPEOF("payloadJson" -> 'sellerEmail') = 'string'
      AND JSONB_TYPEOF("payloadJson" -> 'eventTitle') = 'string'
      AND JSONB_TYPEOF("payloadJson" -> 'appOrigin') = 'string'
      AND NULLIF(BTRIM("payloadJson" ->> 'sellerName'), '') IS NOT NULL
      AND NULLIF(BTRIM("payloadJson" ->> 'sellerEmail'), '') IS NOT NULL
      AND NULLIF(BTRIM("payloadJson" ->> 'eventTitle'), '') IS NOT NULL
      AND NULLIF(BTRIM("payloadJson" ->> 'appOrigin'), '') IS NOT NULL
    ),
  ADD CONSTRAINT "TransferProofReviewDeliveryIntent_envelope_digest_check"
    CHECK ("envelopeDigest" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION transfer_proof_review_escape_html(value TEXT)
RETURNS TEXT AS $$
  SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    value, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION transfer_proof_review_envelope_digest(
  order_id TEXT,
  request_id TEXT,
  recipient_value TEXT,
  requested_at_value TEXT,
  seller_name TEXT,
  seller_email TEXT,
  event_title TEXT,
  app_origin TEXT,
  subject_value TEXT,
  text_body TEXT,
  html_body TEXT
)
RETURNS TEXT AS $$
  SELECT ENCODE(SHA256(CONVERT_TO(
    OCTET_LENGTH(order_id)::TEXT || ':' || order_id
    || OCTET_LENGTH(request_id)::TEXT || ':' || request_id
    || OCTET_LENGTH(recipient_value)::TEXT || ':' || recipient_value
    || OCTET_LENGTH(requested_at_value)::TEXT || ':' || requested_at_value
    || OCTET_LENGTH(seller_name)::TEXT || ':' || seller_name
    || OCTET_LENGTH(seller_email)::TEXT || ':' || seller_email
    || OCTET_LENGTH(event_title)::TEXT || ':' || event_title
    || OCTET_LENGTH(app_origin)::TEXT || ':' || app_origin
    || OCTET_LENGTH(subject_value)::TEXT || ':' || subject_value
    || OCTET_LENGTH(text_body)::TEXT || ':' || text_body
    || OCTET_LENGTH(html_body)::TEXT || ':' || html_body,
    'UTF8'
  )), 'hex');
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION require_transfer_proof_review_delivery_subject()
RETURNS trigger AS $$
DECLARE
  parent_order RECORD;
  seller_user RECORD;
  seller_row RECORD;
  proof_data JSONB;
  expected_requested_at TEXT;
  expected_key TEXT;
  expected_seller_name TEXT;
  expected_event_title TEXT;
  expected_payload JSONB;
  expected_subject TEXT;
  expected_text_body TEXT;
  expected_html_body TEXT;
  expected_review_url TEXT;
  app_origin TEXT;
  database_now TIMESTAMP(3);
BEGIN
  database_now := statement_timestamp() AT TIME ZONE 'UTC';
  IF NEW.status IS DISTINCT FROM 'PENDING'
    OR NEW.provider IS NOT NULL
    OR NEW."attemptCount" <> 0
    OR NEW."firstAttemptAt" IS NOT NULL
    OR NEW."processingAt" IS NOT NULL
    OR NEW."leaseExpiresAt" IS NOT NULL
    OR NEW."claimToken" IS NOT NULL
    OR NEW."dispatchStartedAt" IS NOT NULL
    OR NEW."providerResult" IS NOT NULL
    OR NEW."lastError" IS NOT NULL
    OR NEW."deliveredAt" IS NOT NULL
    OR NEW."availableAt" IS DISTINCT FROM NEW."requestedAt"
    OR NEW."requestedAt" < database_now - INTERVAL '5 seconds'
    OR NEW."requestedAt" > database_now THEN
    RAISE EXCEPTION 'New transfer-proof review delivery intents must originate pending';
  END IF;

  SELECT
    parent_order_row.status::text AS order_status,
    parent_order_row."buyerConfirmationStatus" AS buyer_confirmation_status,
    parent_order_row."transferVerificationStatus" AS transfer_verification_status,
    parent_order_row."disputeWindowEndsAt" AS dispute_window_ends_at,
    parent_order_row."transferProofData" AS transfer_proof_data,
    parent_order_row."sellerId" AS seller_id
  INTO parent_order
  FROM "Order" parent_order_row
  WHERE parent_order_row.id = NEW."orderId"
  FOR UPDATE;

  IF NOT FOUND OR (
    parent_order.order_status = 'PAID'
    AND parent_order.buyer_confirmation_status = 'PENDING'
    AND parent_order.transfer_verification_status = 'MANUAL_REVIEW'
    AND parent_order.dispute_window_ends_at IS NULL
    AND NULLIF(BTRIM(parent_order.transfer_proof_data), '') IS NOT NULL
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Transfer-proof review delivery requires a pending manual-review order';
  END IF;

  BEGIN
    proof_data := parent_order.transfer_proof_data::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Transfer-proof review delivery requires structured proof evidence';
  END;

  SELECT seller.*
  INTO seller_row
  FROM "Seller" seller
  WHERE seller.id = parent_order.seller_id
  FOR SHARE;

  SELECT seller_user_row.id, seller_user_row.email,
    seller_user_row."firstName", seller_user_row."lastName"
  INTO seller_user
  FROM "User" seller_user_row
  WHERE seller_user_row."sellerId" = parent_order.seller_id
  FOR SHARE;

  IF seller_row.id IS NULL OR seller_user.id IS NULL THEN
    RAISE EXCEPTION 'Transfer-proof review delivery requires its current seller identity';
  END IF;

  SELECT COALESCE(NULLIF(ticket.title, ''), 'Ticket order')
  INTO expected_event_title
  FROM "OrderItem" item
  JOIN "Ticket" ticket ON ticket.id = item."ticketId"
  WHERE item."orderId" = NEW."orderId"
  ORDER BY item."createdAt" ASC, item.id ASC
  LIMIT 1
  FOR SHARE OF item, ticket;
  expected_event_title := COALESCE(expected_event_title, 'Ticket order');

  expected_seller_name := COALESCE(
    NULLIF(CONCAT_WS(' ', NULLIF(seller_user."firstName", ''), NULLIF(seller_user."lastName", '')), ''),
    NULLIF(seller_row.name, ''),
    'Seller'
  );
  expected_requested_at := TO_CHAR(NEW."requestedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expected_key := 'tft-human-review-' || ENCODE(SHA256(CONVERT_TO(
    NEW."orderId" || ':' || NEW."requestId" || ':' || NEW.recipient,
    'UTF8'
  )), 'hex');

  app_origin := NEW."payloadJson" ->> 'appOrigin';
  IF app_origin !~ '^https://((www\.)?truefantix\.(com|ca)|truefantix-(web|staging)\.vercel\.app)$'
    AND app_origin !~ '^http://(localhost|127\.0\.0\.1):[0-9]{1,5}$' THEN
    RAISE EXCEPTION 'Transfer-proof review delivery application origin is not approved';
  END IF;
  IF NEW."orderId" !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Transfer-proof review order identifier is not URL safe';
  END IF;

  expected_payload := JSONB_BUILD_OBJECT(
    'sellerName', expected_seller_name,
    'sellerEmail', seller_user.email,
    'eventTitle', expected_event_title,
    'appOrigin', app_origin
  );
  expected_review_url := app_origin || '/admin/orders/' || NEW."orderId";
  expected_subject := 'ACTION REQUIRED: Human Review Requested for Transfer Proof — ' || NEW."orderId";
  expected_text_body := expected_seller_name || ' (' || seller_user.email
    || E') requested a human review of transfer documentation.\n\nOrder: '
    || NEW."orderId" || E'\nEvent: ' || expected_event_title
    || E'\nRequested: ' || expected_requested_at
    || E'\n\nReview the stored documentation:\n' || expected_review_url;
  expected_html_body := '<p><strong>' || transfer_proof_review_escape_html(expected_seller_name)
    || '</strong> (' || transfer_proof_review_escape_html(seller_user.email)
    || ') requested a human review of transfer documentation.</p>' || E'\n'
    || '<p><strong>Order:</strong> ' || transfer_proof_review_escape_html(NEW."orderId")
    || '<br><strong>Event:</strong> ' || transfer_proof_review_escape_html(expected_event_title)
    || '<br><strong>Requested:</strong> ' || expected_requested_at || '</p>' || E'\n'
    || '<p><a href="' || transfer_proof_review_escape_html(expected_review_url)
    || '">Review the order and documentation</a></p>';

  IF JSONB_TYPEOF(proof_data) IS DISTINCT FROM 'object'
    OR proof_data ->> 'manualReviewRequestId' IS DISTINCT FROM NEW."requestId"
    OR proof_data ->> 'manualReviewRequestedAt' IS DISTINCT FROM expected_requested_at
    OR proof_data ->> 'requestedByUserId' IS DISTINCT FROM seller_user.id
    OR NEW.recipient IS DISTINCT FROM 'support@truefantix.com'
    OR NEW."idempotencyKey" IS DISTINCT FROM expected_key
    OR NEW."payloadJson" IS DISTINCT FROM expected_payload
    OR NEW.subject IS DISTINCT FROM expected_subject
    OR NEW."textBody" IS DISTINCT FROM expected_text_body
    OR NEW."htmlBody" IS DISTINCT FROM expected_html_body
    OR NEW."envelopeDigest" IS DISTINCT FROM transfer_proof_review_envelope_digest(
      NEW."orderId", NEW."requestId", NEW.recipient, expected_requested_at,
      expected_seller_name, seller_user.email, expected_event_title, app_origin,
      expected_subject, expected_text_body, expected_html_body
    ) THEN
    RAISE EXCEPTION 'Transfer-proof review delivery envelope must match the locked review snapshot';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_transfer_proof_review_envelope_snapshot()
RETURNS trigger AS $$
BEGIN
  IF OLD."payloadJson" IS DISTINCT FROM NEW."payloadJson"
    OR OLD."envelopeDigest" IS DISTINCT FROM NEW."envelopeDigest" THEN
    RAISE EXCEPTION 'Transfer-proof review delivery snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofReviewDeliveryIntent_snapshot_update"
BEFORE UPDATE ON "TransferProofReviewDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION protect_transfer_proof_review_envelope_snapshot();

COMMIT;
