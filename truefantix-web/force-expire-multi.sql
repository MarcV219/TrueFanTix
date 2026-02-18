UPDATE "Ticket"
SET "reservedUntil" = datetime('now', '-1 minute')
WHERE "reservedByOrderId" = 'cmky06pgz0004s0uniigop7ap';
