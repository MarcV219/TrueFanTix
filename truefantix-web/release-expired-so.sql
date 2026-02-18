UPDATE "Ticket"
SET
  status = 'AVAILABLE',
  reservedUntil = NULL,
  reservedByOrderId = NULL
WHERE id IN ('ticket_so_1','ticket_so_2')
  AND status = 'RESERVED'
  AND reservedUntil IS NOT NULL
  AND julianday(reservedUntil) <= julianday('now');
