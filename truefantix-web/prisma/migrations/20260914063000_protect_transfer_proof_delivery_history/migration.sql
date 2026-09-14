-- Delivery intents are the durable authorization, provider identity, retry,
-- and reconciliation history for transfer-proof notifications. Preserve that
-- evidence after every lifecycle outcome instead of allowing it to be erased.
CREATE OR REPLACE FUNCTION reject_transfer_proof_delivery_intent_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Transfer-proof delivery intents are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferProofDeliveryIntent_append_only"
BEFORE DELETE ON "TransferProofDeliveryIntent"
FOR EACH ROW EXECUTE FUNCTION reject_transfer_proof_delivery_intent_delete();

CREATE TRIGGER "TransferProofDeliveryIntent_no_truncate"
BEFORE TRUNCATE ON "TransferProofDeliveryIntent"
FOR EACH STATEMENT EXECUTE FUNCTION reject_transfer_proof_delivery_intent_delete();
