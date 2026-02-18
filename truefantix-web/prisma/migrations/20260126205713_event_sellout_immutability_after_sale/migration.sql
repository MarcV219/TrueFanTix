-- Block changing selloutStatus after any order exists for tickets in that event
CREATE TRIGGER IF NOT EXISTS "event_sellout_immutable_after_order"
BEFORE UPDATE OF "selloutStatus" ON "Event"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM "Ticket" t
  JOIN "Order" o ON o."ticketId" = t."id"
  WHERE t."eventId" = OLD."id"
)
AND NEW."selloutStatus" <> OLD."selloutStatus"
BEGIN
  SELECT RAISE(ABORT, 'selloutStatus cannot be changed after an order exists for this event');
END;
