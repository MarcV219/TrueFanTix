SELECT id, status, reservedByOrderId, reservedUntil
FROM "Ticket"
WHERE id IN ('ticket_so_1','ticket_so_2')
ORDER BY id;
