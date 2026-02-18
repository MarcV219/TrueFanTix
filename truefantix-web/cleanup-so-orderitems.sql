-- 1) Delete order items for these tickets
DELETE FROM "OrderItem"
WHERE ticketId IN ('ticket_so_1','ticket_so_2');

-- 2) Delete any orders that now have no items
DELETE FROM "Order"
WHERE id NOT IN (SELECT DISTINCT orderId FROM "OrderItem");

-- 3) Ensure tickets are free
UPDATE "Ticket"
SET status = 'AVAILABLE',
    reservedUntil = NULL,
    reservedByOrderId = NULL
WHERE id IN ('ticket_so_1','ticket_so_2');
