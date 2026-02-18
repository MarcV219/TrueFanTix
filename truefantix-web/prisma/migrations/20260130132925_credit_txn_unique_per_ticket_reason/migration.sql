/*
  Warnings:

  - A unique constraint covering the columns `[orderId,ticketId,sellerId,type,source]` on the table `CreditTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_orderId_ticketId_sellerId_type_source_key" ON "CreditTransaction"("orderId", "ticketId", "sellerId", "type", "source");
