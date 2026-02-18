UPDATE "Ticket"
SET reservedUntil = datetime('now', '-1 minute')
WHERE id IN ('ticket_so_1','ticket_so_2');
