-- Catalog-review state is part of the delivery authorization, not only its
-- immutable envelope. Serialize review transitions with the dispatch boundary
-- so a delayed worker cannot send a stale "needs review" notification.
LOCK TABLE "CatalogRequest" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "SpotifyCatalogRequestDeliveryIntent" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SpotifyCatalogRequestDeliveryIntent" intent
    JOIN "SpotifyCatalogRequestDeliveryItem" item
      ON item."intentId" = intent.id
    JOIN "CatalogRequest" request
      ON request.id = item."catalogRequestId"
    WHERE intent.status = 'PROCESSING'
      AND intent."attemptCount" = 1
      AND intent."dispatchStartedAt" IS NOT NULL
      AND request.status <> 'PENDING'
  ) THEN
    RAISE EXCEPTION 'Active Spotify catalog delivery has stale request status';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION protect_spotify_catalog_request_identity()
RETURNS trigger AS $$
DECLARE
  delivery_status TEXT;
  delivery_attempt_count INTEGER;
  delivery_dispatch_started_at TIMESTAMP(3);
BEGIN
  IF (
    NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."requestedType" IS DISTINCT FROM OLD."requestedType"
    OR NEW."requestedValue" IS DISTINCT FROM OLD."requestedValue"
  ) AND EXISTS (
    SELECT 1
    FROM "SpotifyCatalogRequestDeliveryItem"
    WHERE "catalogRequestId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'Catalog request identity is immutable after Spotify delivery reservation';
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT intent.status, intent."attemptCount", intent."dispatchStartedAt"
      INTO delivery_status, delivery_attempt_count, delivery_dispatch_started_at
    FROM "SpotifyCatalogRequestDeliveryItem" item
    JOIN "SpotifyCatalogRequestDeliveryIntent" intent
      ON intent.id = item."intentId"
    WHERE item."catalogRequestId" = OLD.id
    FOR UPDATE OF intent;

    IF delivery_status = 'PROCESSING'
      AND delivery_attempt_count = 1
      AND delivery_dispatch_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'Catalog request review is blocked during Spotify delivery dispatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
