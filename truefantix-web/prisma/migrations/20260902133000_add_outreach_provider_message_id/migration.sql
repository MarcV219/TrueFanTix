ALTER TABLE "OutreachRecipient"
ADD COLUMN "providerMessageId" TEXT;

CREATE INDEX "OutreachRecipient_providerMessageId_idx"
ON "OutreachRecipient"("providerMessageId");
