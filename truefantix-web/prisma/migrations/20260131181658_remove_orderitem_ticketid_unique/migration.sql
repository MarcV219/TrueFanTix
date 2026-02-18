-- DropIndex
DROP INDEX "OrderItem_ticketId_key";

-- CreateIndex
CREATE INDEX "OrderItem_ticketId_idx" ON "OrderItem"("ticketId");
