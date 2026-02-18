PRAGMA foreign_keys=ON;

-- CLEANUP (idempotent)
DELETE FROM "OrderItem" WHERE "id" IN ('oi1_trigger_test','oi2_trigger_test');
DELETE FROM "Order"     WHERE "id" = 'order_trigger_test';
DELETE FROM "Ticket"    WHERE "id" IN ('ticket1_trigger_test','ticket2_trigger_test');
DELETE FROM "Event"     WHERE "id" = 'event_trigger_test';
DELETE FROM "Seller"    WHERE "id" IN ('seller_trigger_test','buyer_trigger_test');

-- Sellers
INSERT INTO "Seller" ("id","name","creditBalanceCredits","rating","reviews","createdAt","updatedAt")
VALUES
  ('seller_trigger_test','Seller Trigger Test',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('buyer_trigger_test','Buyer Trigger Test',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- Event
INSERT INTO "Event" ("id","title","venue","date","selloutStatus","createdAt","updatedAt")
VALUES ('event_trigger_test','Event Trigger Test','Trigger Venue','2026-02-01','NOT_SOLD_OUT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- Two tickets for the same event
INSERT INTO "Ticket" ("id","eventId","sellerId","status","title","venue","date","faceValueCents","priceCents","image","createdAt","updatedAt")
VALUES
  ('ticket1_trigger_test','event_trigger_test','seller_trigger_test','AVAILABLE','Trigger Ticket 1','Trigger Venue','2026-02-01',10000,10000,'img',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('ticket2_trigger_test','event_trigger_test','seller_trigger_test','AVAILABLE','Trigger Ticket 2','Trigger Venue','2026-02-01',10000,10000,'img',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- Order header
INSERT INTO "Order" ("id","sellerId","buyerSellerId","status","amountCents","adminFeeCents","totalCents","createdAt")
VALUES ('order_trigger_test','seller_trigger_test','buyer_trigger_test','PENDING',20000,1750,21750,CURRENT_TIMESTAMP);

-- Order items
INSERT INTO "OrderItem" ("id","orderId","ticketId","priceCents","faceValueCents","createdAt")
VALUES
  ('oi1_trigger_test','order_trigger_test','ticket1_trigger_test',10000,10000,CURRENT_TIMESTAMP),
  ('oi2_trigger_test','order_trigger_test','ticket2_trigger_test',10000,10000,CURRENT_TIMESTAMP);

-- Attempt forbidden update (should ABORT due to trigger)
UPDATE "Event"
SET "selloutStatus" = 'SOLD_OUT'
WHERE "id" = 'event_trigger_test';
