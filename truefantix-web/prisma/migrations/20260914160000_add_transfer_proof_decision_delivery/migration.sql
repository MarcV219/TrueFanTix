-- Human-review decisions must commit all seller and accepted-proof delivery
-- work before provider I/O. Reuse the hardened transfer-proof delivery
-- lifecycle while giving decision envelopes their own source authorization.
BEGIN;

LOCK TABLE "TransferProofDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TransferProofDeliveryIntent"
    WHERE kind = 'SELLER_REVIEW_DECISION_EMAIL'
  ) THEN
    RAISE EXCEPTION 'Seller review-decision delivery history predates its authorization boundary';
  END IF;
END;
$$;

-- The predecessor trigger intentionally rejects unknown kinds. Limit it to
-- the two accepted-proof kinds it authorizes and install a separate decision
-- authorizer below. A final guard continues to reject every unsupported kind.
DROP TRIGGER "TransferProofDeliveryIntent_order_subject_insert"
ON "TransferProofDeliveryIntent";

CREATE TRIGGER "TransferProofDeliveryIntent_order_subject_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW
WHEN (NEW.kind IN ('BUYER_CONFIRMATION_EMAIL', 'ADMIN_TRANSFER_ACTIVITY_EMAIL'))
EXECUTE FUNCTION require_transfer_proof_delivery_subject();

DROP TRIGGER "TransferProofDeliveryIntent_z_order_clock_insert"
ON "TransferProofDeliveryIntent";

CREATE TRIGGER "TransferProofDeliveryIntent_z_order_clock_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW
WHEN (NEW.kind IN ('BUYER_CONFIRMATION_EMAIL', 'ADMIN_TRANSFER_ACTIVITY_EMAIL'))
EXECUTE FUNCTION require_transfer_proof_delivery_authoritative_clock();

CREATE OR REPLACE FUNCTION require_transfer_proof_seller_decision_delivery()
RETURNS trigger AS $$
DECLARE
  parent_order RECORD;
  seller_user RECORD;
  reason_json JSONB;
  proof_json JSONB;
  decision_json JSONB;
  payload_field_count INTEGER;
  expected_origin TEXT;
  expected_status TEXT;
  expected_key TEXT;
  canonical_envelope TEXT;
  expected_digest TEXT;
  expected_heading TEXT;
  expected_instruction TEXT;
  expected_subject TEXT;
  expected_text_body TEXT;
  expected_html_body TEXT;
  expected_greeting TEXT;
  expected_holding_url TEXT;
BEGIN
  IF NEW.kind <> 'SELLER_REVIEW_DECISION_EMAIL' THEN
    RAISE EXCEPTION 'Unsupported seller review-decision delivery kind';
  END IF;

  SELECT
    source_order.id,
    source_order.status::text AS status,
    source_order."buyerConfirmationStatus" AS buyer_confirmation_status,
    source_order."transferVerificationStatus" AS transfer_verification_status,
    source_order."transferVerificationReason" AS transfer_verification_reason,
    source_order."transferProofData" AS transfer_proof_data,
    source_order."transferProofType" AS transfer_proof_type,
    source_order."disputeWindowEndsAt" AS dispute_window_ends_at,
    source_order."sellerId" AS seller_id
  INTO parent_order
  FROM "Order" source_order
  WHERE source_order.id = NEW."orderId"
  FOR UPDATE;

  IF NOT FOUND
    OR parent_order.status <> 'PAID'
    OR parent_order.buyer_confirmation_status IS DISTINCT FROM 'PENDING'
    OR NULLIF(BTRIM(parent_order.transfer_verification_reason), '') IS NULL
    OR NULLIF(BTRIM(parent_order.transfer_proof_data), '') IS NULL THEN
    RAISE EXCEPTION 'Seller review-decision delivery requires its decided paid order';
  END IF;

  BEGIN
    reason_json := parent_order.transfer_verification_reason::jsonb;
    proof_json := parent_order.transfer_proof_data::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Seller review-decision delivery requires canonical decision history';
  END;

  IF JSONB_TYPEOF(reason_json) IS DISTINCT FROM 'object'
    OR JSONB_TYPEOF(proof_json) IS DISTINCT FROM 'object'
    OR JSONB_TYPEOF(proof_json -> 'adminReviews') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Seller review-decision delivery requires canonical decision history';
  END IF;

  SELECT seller_identity.id, seller_identity.email, seller_identity."firstName"
  INTO seller_user
  FROM "User" seller_identity
  WHERE seller_identity."sellerId" = parent_order.seller_id
  FOR SHARE;

  IF NOT FOUND OR NULLIF(BTRIM(seller_user.email), '') IS NULL
    OR NEW.recipient IS DISTINCT FROM seller_user.email THEN
    RAISE EXCEPTION 'Seller review-decision recipient must match the order seller';
  END IF;

  SELECT COUNT(*) INTO payload_field_count
  FROM JSONB_OBJECT_KEYS(NEW."payloadJson");
  IF JSONB_TYPEOF(NEW."payloadJson") IS DISTINCT FROM 'object'
    OR payload_field_count <> 11
    OR NEW."payloadJson" ->> 'action' NOT IN ('APPROVE', 'REJECT', 'REQUEST_INFORMATION')
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'action') IS DISTINCT FROM 'string'
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'appOrigin') IS DISTINCT FROM 'string'
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'decidedAt') IS DISTINCT FROM 'string'
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'decidedByUserId') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'decidedByUserId'), '') IS NULL
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'decisionId') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'decisionId'), '') IS NULL
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'note') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'note'), '') IS NULL
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'subject') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'subject'), '') IS NULL
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'textBody') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'textBody'), '') IS NULL
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'htmlBody') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'htmlBody'), '') IS NULL
    OR JSONB_TYPEOF(NEW."payloadJson" -> 'sellerUserId') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(NEW."payloadJson" ->> 'sellerUserId'), '') IS NULL
    OR (
      JSONB_TYPEOF(NEW."payloadJson" -> 'sellerFirstName') IS DISTINCT FROM 'string'
      AND JSONB_TYPEOF(NEW."payloadJson" -> 'sellerFirstName') IS DISTINCT FROM 'null'
    ) THEN
    RAISE EXCEPTION 'Seller review-decision delivery payload must have the canonical shape';
  END IF;

  expected_origin := canonical_transfer_proof_review_origin();
  IF NEW."payloadJson" ->> 'appOrigin' IS DISTINCT FROM expected_origin
    OR NEW."payloadJson" ->> 'sellerFirstName' IS DISTINCT FROM seller_user."firstName"
    OR NEW."payloadJson" ->> 'sellerUserId' IS DISTINCT FROM seller_user.id THEN
    RAISE EXCEPTION 'Seller review-decision delivery payload must match its environment and seller';
  END IF;

  IF NEW."payloadJson" ->> 'decidedAt'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR TO_CHAR(
      (NEW."payloadJson" ->> 'decidedAt')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) IS DISTINCT FROM NEW."payloadJson" ->> 'decidedAt' THEN
    RAISE EXCEPTION 'Seller review-decision clock must be an exact ISO timestamp';
  END IF;

  decision_json := JSONB_BUILD_OBJECT(
    'id', NEW."payloadJson" ->> 'decisionId',
    'action', NEW."payloadJson" ->> 'action',
    'note', NEW."payloadJson" ->> 'note',
    'decidedAt', NEW."payloadJson" ->> 'decidedAt',
    'decidedByUserId', NEW."payloadJson" ->> 'decidedByUserId'
  );
  IF reason_json IS DISTINCT FROM decision_json || JSONB_BUILD_OBJECT(
      'type', 'TRANSFER_PROOF_ADMIN_REVIEW'
    )
    OR (proof_json -> 'adminReviews' -> -1) IS DISTINCT FROM decision_json THEN
    RAISE EXCEPTION 'Seller review-decision envelope must match the latest durable decision';
  END IF;

  expected_status := CASE NEW."payloadJson" ->> 'action'
    WHEN 'APPROVE' THEN 'PENDING'
    WHEN 'REJECT' THEN 'MISMATCHED'
    ELSE 'MANUAL_REVIEW'
  END;
  IF parent_order.transfer_verification_status IS DISTINCT FROM expected_status
    OR (
      NEW."payloadJson" ->> 'action' = 'APPROVE'
      AND (
        parent_order.dispute_window_ends_at IS NULL
        OR NULLIF(BTRIM(parent_order.transfer_proof_type), '') IS NULL
      )
    )
    OR (
      NEW."payloadJson" ->> 'action' <> 'APPROVE'
      AND parent_order.transfer_proof_type IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'Seller review-decision envelope must match the decided order state';
  END IF;

  expected_heading := CASE NEW."payloadJson" ->> 'action'
    WHEN 'APPROVE' THEN 'Transfer proof approved'
    WHEN 'REJECT' THEN 'Transfer proof needs to be replaced'
    ELSE 'ACTION REQUIRED: More transfer information needed'
  END;
  expected_instruction := CASE NEW."payloadJson" ->> 'action'
    WHEN 'APPROVE' THEN 'No further transfer-proof action is required right now. The buyer has been asked to confirm receipt.'
    WHEN 'REJECT' THEN 'Please upload corrected transfer documentation from Seller Holding.'
    ELSE 'Please upload the requested supporting information from Seller Holding so Support can complete its review.'
  END;
  expected_subject := CASE NEW."payloadJson" ->> 'action'
    WHEN 'APPROVE' THEN 'Transfer Proof Approved — ' || NEW."orderId"
    ELSE 'ACTION REQUIRED: ' || expected_heading || ' — ' || NEW."orderId"
  END;
  expected_greeting := COALESCE(NULLIF(NEW."payloadJson" ->> 'sellerFirstName', ''), 'there');
  expected_holding_url := expected_origin || '/account/tickets/seller-holding';
  expected_text_body := expected_heading || E'\n\nHi ' || expected_greeting
    || E',\n\nSupport reviewed the transfer proof for order ' || NEW."orderId"
    || E'.\n\nSupport note:\n' || (NEW."payloadJson" ->> 'note')
    || E'\n\n' || expected_instruction || E'\n\n' || expected_holding_url
    || E'\n\nThanks,\nThe TrueFanTix Team';
  expected_html_body := '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><div style="background:#064a93;color:white;padding:20px;border-radius:8px 8px 0 0"><strong>'
    || transfer_proof_review_escape_html(expected_heading)
    || '</strong></div><div style="background:#f9fafb;padding:24px"><p>Hi '
    || transfer_proof_review_escape_html(expected_greeting)
    || ',</p><p>Support reviewed the transfer proof for order <strong>'
    || transfer_proof_review_escape_html(NEW."orderId")
    || '</strong>.</p><div style="background:white;border-left:4px solid #f97316;padding:16px;margin:18px 0"><strong>Support note</strong><p style="white-space:pre-wrap">'
    || transfer_proof_review_escape_html(NEW."payloadJson" ->> 'note')
    || '</p></div><p>' || transfer_proof_review_escape_html(expected_instruction)
    || '</p><p><a href="' || transfer_proof_review_escape_html(expected_holding_url)
    || '" style="display:inline-block;background:#064a93;color:white;padding:12px 20px;text-decoration:none;border-radius:7px;font-weight:bold">Open Seller Holding</a></p></div></div>';
  IF NEW."payloadJson" ->> 'subject' IS DISTINCT FROM expected_subject
    OR NEW."payloadJson" ->> 'textBody' IS DISTINCT FROM expected_text_body
    OR NEW."payloadJson" ->> 'htmlBody' IS DISTINCT FROM expected_html_body THEN
    RAISE EXCEPTION 'Seller review-decision rendered envelope must be canonical';
  END IF;

  expected_key := NEW."orderId" || ':' || (NEW."payloadJson" ->> 'decisionId')
    || ':' || NEW.kind || ':' || NEW.recipient;
  IF NEW."idempotencyKey" IS DISTINCT FROM expected_key THEN
    RAISE EXCEPTION 'Seller review-decision idempotency key must match its decision';
  END IF;

  canonical_envelope :=
    '{"kind":' || TO_JSONB(NEW.kind)::text
    || ',"orderId":' || TO_JSONB(NEW."orderId")::text
    || ',"payloadJson":{"action":' || (NEW."payloadJson" -> 'action')::text
    || ',"appOrigin":' || (NEW."payloadJson" -> 'appOrigin')::text
    || ',"decidedAt":' || (NEW."payloadJson" -> 'decidedAt')::text
    || ',"decidedByUserId":' || (NEW."payloadJson" -> 'decidedByUserId')::text
    || ',"decisionId":' || (NEW."payloadJson" -> 'decisionId')::text
    || ',"htmlBody":' || (NEW."payloadJson" -> 'htmlBody')::text
    || ',"note":' || (NEW."payloadJson" -> 'note')::text
    || ',"sellerFirstName":' || (NEW."payloadJson" -> 'sellerFirstName')::text
    || ',"sellerUserId":' || (NEW."payloadJson" -> 'sellerUserId')::text
    || ',"subject":' || (NEW."payloadJson" -> 'subject')::text
    || ',"textBody":' || (NEW."payloadJson" -> 'textBody')::text
    || '},"recipient":' || TO_JSONB(NEW.recipient)::text || '}';
  expected_digest := ENCODE(SHA256(CONVERT_TO(canonical_envelope, 'UTF8')), 'hex');
  IF NEW."identityVersion" IS DISTINCT FROM 2
    OR NEW."envelopeDigest" IS DISTINCT FROM expected_digest THEN
    RAISE EXCEPTION 'Seller review-decision digest must match its canonical envelope';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_order_seller_decision_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW
WHEN (NEW.kind = 'SELLER_REVIEW_DECISION_EMAIL')
EXECUTE FUNCTION require_transfer_proof_seller_decision_delivery();

CREATE OR REPLACE FUNCTION reject_unsupported_transfer_proof_delivery_kind()
RETURNS trigger AS $$
BEGIN
  IF NEW.kind NOT IN (
    'BUYER_CONFIRMATION_EMAIL',
    'ADMIN_TRANSFER_ACTIVITY_EMAIL',
    'SELLER_REVIEW_DECISION_EMAIL'
  ) THEN
    RAISE EXCEPTION 'Unsupported transfer-proof delivery kind';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_supported_kind_insert"
BEFORE INSERT ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION reject_unsupported_transfer_proof_delivery_kind();

-- A staged seller decision freezes both delivery addresses and the seller
-- greeting/name source until its email has reached a terminal outcome.
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
    JOIN "TransferProofDeliveryIntent" intent ON intent."orderId" = parent_order.id
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
    JOIN "TransferProofDeliveryIntent" intent ON intent."orderId" = parent_order.id
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
    JOIN "TransferProofDeliveryIntent" intent ON intent."orderId" = parent_order.id
    WHERE intent."identityVersion" = 2
      AND intent.status IN ('PENDING', 'PROCESSING', 'FAILED')
      AND (
        (intent.kind = 'BUYER_CONFIRMATION_EMAIL' AND parent_order."buyerSellerId" = prior_seller_id)
        OR (intent.kind = 'SELLER_REVIEW_DECISION_EMAIL' AND parent_order."sellerId" = prior_seller_id)
      )
  ) THEN
    RAISE EXCEPTION 'Active transfer-proof delivery buyer name is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Seller-decision envelopes do not snapshot the accepted proof clock or item
-- membership. Keep the predecessor's permanent reverse fence only for its two
-- accepted-proof kinds; a pending decision still pins the seller relationship
-- through the active-participant guard until delivery resolves.
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
      AND intent.kind IN ('BUYER_CONFIRMATION_EMAIL', 'ADMIN_TRANSFER_ACTIVITY_EMAIL')
  ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery order snapshot is immutable';
  END IF;
  IF OLD."sellerId" IS DISTINCT FROM NEW."sellerId" AND EXISTS (
    SELECT 1
    FROM "TransferProofDeliveryIntent" intent
    WHERE intent."orderId" = OLD.id
      AND intent."identityVersion" = 2
      AND intent.kind = 'SELLER_REVIEW_DECISION_EMAIL'
      AND intent.status IN ('PENDING', 'PROCESSING', 'FAILED')
  ) THEN
    RAISE EXCEPTION 'Active seller review-decision identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
      AND intent.kind IN ('BUYER_CONFIRMATION_EMAIL', 'ADMIN_TRANSFER_ACTIVITY_EMAIL')
      AND intent."orderId" IN (prior_order_id, next_order_id)
  ) THEN
    RAISE EXCEPTION 'Transfer-proof delivery order item membership is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
