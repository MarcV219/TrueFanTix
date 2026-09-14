-- Migration 89 introduced the canonical version-2 identity check, but its
-- preflight did not lock out an already-running writer. Such a writer could
-- commit a poisoned version-2 row after the preflight snapshot and before the
-- stricter INSERT trigger became effective. Migration 90 serialized its own
-- clock-only audit, but intentionally did not recompute the full identity.
-- Re-audit the complete current identity under one early write-conflicting
-- lock so no missed writer can leave immutable malformed history behind.
BEGIN;

LOCK TABLE "TransferProofDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  delivery RECORD;
  expected_window TEXT;
  expected_key TEXT;
  expected_digest TEXT;
  expected_clock TEXT;
BEGIN
  FOR delivery IN
    SELECT
      intent.id,
      intent."orderId",
      intent.kind,
      intent.recipient,
      intent."payloadJson",
      intent."idempotencyKey",
      intent."envelopeDigest",
      parent_order."disputeWindowEndsAt"
    FROM "TransferProofDeliveryIntent" intent
    LEFT JOIN "Order" parent_order ON parent_order.id = intent."orderId"
    WHERE intent."identityVersion" = 2
    ORDER BY intent.id
  LOOP
    expected_window := transfer_proof_delivery_identity_window(
      delivery.kind,
      delivery."payloadJson"
    );
    expected_key := delivery."orderId" || ':' || expected_window || ':'
      || delivery.kind || ':' || delivery.recipient;
    expected_digest := ENCODE(SHA256(CONVERT_TO(
      canonical_transfer_proof_delivery_envelope(
        delivery."orderId",
        delivery.kind,
        delivery.recipient,
        delivery."payloadJson"
      ),
      'UTF8'
    )), 'hex');

    IF delivery."idempotencyKey" IS DISTINCT FROM expected_key
      OR delivery."envelopeDigest" IS DISTINCT FROM expected_digest THEN
      RAISE EXCEPTION 'Transfer-proof delivery identity revalidation failed for row %', delivery.id;
    END IF;

    IF delivery."disputeWindowEndsAt" IS NULL THEN
      RAISE EXCEPTION 'Transfer-proof delivery clock revalidation failed for row %', delivery.id;
    END IF;
    IF delivery.kind = 'BUYER_CONFIRMATION_EMAIL' THEN
      expected_clock := transfer_proof_delivery_authoritative_window(
        delivery."disputeWindowEndsAt"
      );
      IF delivery."payloadJson" ->> 'windowStart' IS DISTINCT FROM expected_clock THEN
        RAISE EXCEPTION 'Transfer-proof delivery clock revalidation failed for row %', delivery.id;
      END IF;
    ELSIF delivery.kind = 'ADMIN_TRANSFER_ACTIVITY_EMAIL' THEN
      expected_clock := transfer_proof_delivery_authoritative_completed_at(
        delivery."disputeWindowEndsAt"
      );
      IF delivery."payloadJson" ->> 'completedAt' IS DISTINCT FROM expected_clock THEN
        RAISE EXCEPTION 'Transfer-proof delivery clock revalidation failed for row %', delivery.id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Transfer-proof delivery identity revalidation failed for row %', delivery.id;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
