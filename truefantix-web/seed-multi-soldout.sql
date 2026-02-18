PRAGMA foreign_keys=ON;

DELETE FROM "CreditTransaction";
DELETE FROM "OrderItem";
DELETE FROM "Payment";
DELETE FROM "Order";
DELETE FROM "Ticket" WHERE "id" IN ('ticket_so_1','ticket_so_2');
DELETE FROM "Event"  WHERE "id" = 'event_so_multi';
DELETE FROM "Seller" WHERE "id" IN ('seller_so','buyer_so');

INSERT INTO "Seller" ("id","name","creditBalanceCredits","rating","reviews","createdAt","updatedAt")
VALUES
  ('seller_so','Seller SO',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('buyer_so','Buyer SO',5,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO "Event" ("id","title","venue","date","selloutStatus","createdAt","updatedAt")
VALUES ('event_so_multi','Soldout Multi Event','SO Venue','2026-04-01','SOLD_OUT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO "Ticket" ("id","eventId","sellerId","status","title","venue","date","faceValueCents","priceCents","image","createdAt","updatedAt")
VALUES
  ('ticket_so_1','event_so_multi','seller_so','AVAILABLE','SO Ticket 1','SO Venue','2026-04-01',10000,10000,'img',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('ticket_so_2','event_so_multi','seller_so','AVAILABLE','SO Ticket 2','SO Venue','2026-04-01',10000,10000,'img',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
