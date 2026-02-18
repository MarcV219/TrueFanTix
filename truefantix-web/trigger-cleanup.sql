PRAGMA foreign_keys=ON;

DELETE FROM "Order"  WHERE "id" = 'order_trigger_test';
DELETE FROM "Ticket" WHERE "id" = 'ticket_trigger_test';
DELETE FROM "Event"  WHERE "id" = 'event_trigger_test';
DELETE FROM "Seller" WHERE "id" IN ('seller_trigger_test','buyer_trigger_test');
