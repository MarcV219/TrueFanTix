UPDATE "Ticket"
SET status = 'AVAILABLE',
    reservedUntil = NULL,
    reservedByOrderId = NULL
WHERE status = 'RESERVED'
  AND reservedUntil IS NOT NULL
  AND julianday(reservedUntil) <= julianday('now');
