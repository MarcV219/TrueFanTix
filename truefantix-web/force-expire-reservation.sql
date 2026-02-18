UPDATE "Ticket"
SET reservedUntil = datetime('now', '-30 minutes')
WHERE id IN ('ticket_so_1','ticket_so_2')
  AND status = 'RESERVED';
