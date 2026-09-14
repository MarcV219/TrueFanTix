-- Transfer-proof delivery history is authorization and provider-attempt
-- evidence for one ordinary marketplace order. Enforce that provenance for
-- every future insert while preserving any immutable orphan history created
-- before this boundary. A clean database validates the constraint immediately;
-- a legacy database with an orphan keeps the constraint NOT VALID so the row
-- can be reviewed without inventing or deleting business history.
ALTER TABLE "TransferProofDeliveryIntent"
ADD CONSTRAINT "TransferProofDeliveryIntent_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE RESTRICT
NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "TransferProofDeliveryIntent" delivery
    LEFT JOIN "Order" parent_order ON parent_order.id = delivery."orderId"
    WHERE parent_order.id IS NULL
  ) THEN
    ALTER TABLE "TransferProofDeliveryIntent"
    VALIDATE CONSTRAINT "TransferProofDeliveryIntent_orderId_fkey";
  END IF;
END;
$$;
