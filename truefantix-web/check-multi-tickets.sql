SELECT id, status, reservedByOrderId, reservedUntil
FROM "Ticket"
WHERE id IN ('ticket_multi_1','ticket_multi_2')
ORDER BY id;
