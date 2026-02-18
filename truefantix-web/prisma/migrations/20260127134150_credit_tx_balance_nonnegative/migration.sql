DROP TRIGGER IF EXISTS "event_sellout_immutable_after_order";

CREATE TRIGGER "event_sellout_immutable_after_order"
BEFORE UPDATE OF "selloutStatus" ON "Event"
FOR EACH ROW
WHEN OLD."selloutStatus" IS NOT NEW."selloutStatus"
BEGIN
  SELECT
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM "Order" o
        JOIN "Ticket" t ON t."id" = o."ticketId"
        WHERE t."eventId" = OLD."id"
      )
      THEN RAISE(ABORT, 'selloutStatus cannot be changed after an order exists for this event')
    END;
END;
