-- Successful delivery evidence uses the exact clock captured when the owned
-- worker crossed the provider boundary. The existing completion transition
-- already rejects missing or earlier evidence; this successor prevents a
-- writer from moving that durable outcome timestamp forward.
CREATE OR REPLACE FUNCTION enforce_transfer_proof_delivery_clock_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PROCESSING'
    AND NEW.status = 'DELIVERED'
    AND OLD."dispatchStartedAt" IS NOT NULL
    AND NEW."deliveredAt" > OLD."dispatchStartedAt" THEN
    RAISE EXCEPTION 'Transfer-proof delivery completion must use its owned dispatch clock';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_delivery_clock_transition"
BEFORE UPDATE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION enforce_transfer_proof_delivery_clock_transition();
