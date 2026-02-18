PRAGMA foreign_keys=ON;

-- CLEANUP FIRST (idempotent: safe to run repeatedly)
DELETE FROM "Order"  WHERE "id" = 'order_trigger_test';
DELETE FROM "Ticket" WHERE "id" = 'ticket_trigger_test';
DELETE FROM "Event"  WHERE "id" = 'event_trigger_test';
DELETE FROM "Seller" WHERE "id" IN ('seller_trigger_test','buyer_trigger_test');

-- Create seller + buyer
INSERT INTO "Seller" ("id","name","creditBalanceCredits","rating","reviews","createdAt","updatedAt")
VALUES
  ('seller_trigger_test','Seller Trigger Test',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('buyer_trigger_test','Buyer Trigger Test',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- Create event
INSERT INTO "Event" (
  "id","title","venue","date","selloutStatus","createdAt","updatedAt"
)
VALUES (
  'event_trigger_test',
  'Event Trigger Test',
  'Trigger Venue',
  '2026-01-01',
  'NOT_SOLD_OUT',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Create ticket (include required image + updatedAt)
INSERT INTO "Ticket" (
  "id","eventId","sellerId","status","title","venue","date",
  "faceValueCents","priceCents","image","createdAt","updatedAt"
)
VALUES (
  'ticket_trigger_test',
  'event_trigger_test',
  'seller_trigger_test',
  'AVAILABLE',
  'Trigger Ticket',
  'Trigger Venue',
  '2026-01-01',
  10000,
  10000,
  'trigger-test-image',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Create order (locks selloutStatus)
INSERT INTO "Order" (
  "id","ticketId","sellerId","buyerSellerId",
  "status","amountCents","adminFeeCents","totalCents","createdAt"
)
VALUES (
  'order_trigger_test',
  'ticket_trigger_test',
  'seller_trigger_test',
  'buyer_trigger_test',
  'PENDING',
  10000,
  875,
  10875,
  CURRENT_TIMESTAMP
);

-- Forbidden update (should ABORT due to trigger)
UPDATE "Event"
SET "selloutStatus" = 'SOLD_OUT'
WHERE "id" = 'event_trigger_test';
