DROP TRIGGER IF EXISTS ticket_prevent_withdraw_active_reservation;

CREATE TRIGGER ticket_prevent_withdraw_active_reservation
BEFORE UPDATE OF status ON "Ticket"
FOR EACH ROW
WHEN
  NEW.status = 'WITHDRAWN'
  AND OLD.status = 'RESERVED'
  AND OLD.reservedUntil IS NOT NULL
  AND OLD.reservedUntil > CURRENT_TIMESTAMP
BEGIN
  SELECT RAISE(ABORT, 'Cannot withdraw: ticket is currently reserved');
END;
