PRAGMA foreign_keys=ON;

DELETE FROM "OrderItem";
DELETE FROM "Order";
DELETE FROM "Ticket" WHERE "id" IN ('ticket_multi_1','ticket_multi_2');
DELETE FROM "Event"  WHERE "id" = 'event_multi';
DELETE FROM "Seller" WHERE "id" IN ('seller_multi','buyer_multi');

INSERT INTO "Seller" ("id","name","creditBalanceCredits","rating","reviews","createdAt","updatedAt")
VALUES
  ('seller_multi','Seller Multi',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('buyer_multi','Buyer Multi',5,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO "Event" ("id","title","venue","date","selloutStatus","createdAt","updatedAt")
VALUES ('event_multi','Multi Event','Multi Venue','2026-03-01','NOT_SOLD_OUT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

INSERT INTO "Ticket" ("id","eventId","sellerId","status","title","venue","date","faceValueCents","priceCents","image","createdAt","updatedAt")
VALUES
  ('ticket_multi_1','event_multi','seller_multi','AVAILABLE','Multi Ticket 1','Multi Venue','2026-03-01',10000,10000,'img',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('ticket_multi_2','event_multi','seller_multi','AVAILABLE','Multi Ticket 2','Multi Venue','2026-03-01',10000,10000,'img',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
