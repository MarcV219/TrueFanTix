-- Preserve a newly staged delivery intent's durable availability boundary.
-- The initial PENDING schedule may be consumed by a due claim, but a
-- same-state update must not accelerate or postpone delivery before then.
CREATE OR REPLACE FUNCTION freeze_pending_transfer_proof_delivery_schedule()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PENDING'
    AND NEW.status = 'PENDING'
    AND NEW."availableAt" IS DISTINCT FROM OLD."availableAt" THEN
    RAISE EXCEPTION 'Pending transfer-proof delivery availability is immutable until claim';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_immutable_pending_schedule"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION freeze_pending_transfer_proof_delivery_schedule();
