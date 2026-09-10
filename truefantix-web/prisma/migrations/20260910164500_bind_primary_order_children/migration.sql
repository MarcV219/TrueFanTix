-- Ensure every financial child belongs to the same reservation/order as its parent.

ALTER TABLE "PrimaryOrder"
  ADD CONSTRAINT "PrimaryOrder_id_reservationId_key" UNIQUE ("id", "reservationId");

ALTER TABLE "PrimaryOrderLine"
  ADD CONSTRAINT "PrimaryOrderLine_id_orderId_key" UNIQUE ("id", "orderId");

ALTER TABLE "PrimaryOrderLine" DROP CONSTRAINT "PrimaryOrderLine_orderId_fkey";
ALTER TABLE "PrimaryOrderPriceComponent" DROP CONSTRAINT "PrimaryOrderPriceComponent_orderLineId_fkey";

ALTER TABLE "PrimaryOrderLine"
  ADD CONSTRAINT "PrimaryOrderLine_order_reservation_fkey"
  FOREIGN KEY ("orderId", "reservationId")
  REFERENCES "PrimaryOrder"("id", "reservationId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PrimaryOrderPriceComponent"
  ADD CONSTRAINT "PrimaryOrderPriceComponent_line_order_fkey"
  FOREIGN KEY ("orderLineId", "orderId")
  REFERENCES "PrimaryOrderLine"("id", "orderId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
