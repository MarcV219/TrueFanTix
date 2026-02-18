PRAGMA foreign_keys=ON;

-- Clean any prior seed rows (safe to re-run)
DELETE FROM "Order"  WHERE "id" = 'order_res_test';
DELETE FROM "Ticket" WHERE "id" = 'ticket_res_test';
DELETE FROM "Event"  WHERE "id" = 'event_res_test';
DELETE FROM "Seller" WHERE "id" IN ('seller_res_test','buyer_res_test');

-- Sellers (seller + buyer)
INSERT INTO "Seller" ("id","name","creditBalanceCredits","rating","reviews","createdAt","updatedAt")
VALUES
  ('seller_res_test','Seller Res Test',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('buyer_res_test','Buyer Res Test',5,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- Event
INSERT INTO "Event" ("id","title","venue","date","selloutStatus","createdAt","updatedAt")
VALUES ('event_res_test','Reservation Test Event','Test Venue','2026-02-01','NOT_SOLD_OUT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

-- Ticket
INSERT INTO "Ticket" (
  "id","eventId","sellerId","status","title","venue","date",
  "faceValueCents","priceCents","image","createdAt","updatedAt"
)
VALUES (
  'ticket_res_test',
  'event_res_test',
  'seller_res_test',
  'AVAILABLE',
  'Reservation Test Ticket',
  'Test Venue',
  '2026-02-01',
  10000,
  10000,
  'seed-image',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
