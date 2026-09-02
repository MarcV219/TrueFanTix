ALTER TABLE "OutreachContact"
ADD COLUMN "engagementStage" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN "followUpAt" TIMESTAMP(3),
ADD COLUMN "adminNotes" TEXT;

ALTER TABLE "OutreachRecipient"
ADD COLUMN "replyToken" TEXT;

UPDATE "OutreachRecipient" SET "replyToken" = "id" WHERE "replyToken" IS NULL;
ALTER TABLE "OutreachRecipient" ALTER COLUMN "replyToken" SET NOT NULL;

CREATE UNIQUE INDEX "OutreachRecipient_replyToken_key" ON "OutreachRecipient"("replyToken");
CREATE INDEX "OutreachContact_engagementStage_followUpAt_idx" ON "OutreachContact"("engagementStage", "followUpAt");

CREATE TABLE "OutreachReply" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerEmailId" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "recipientId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "textBody" TEXT,
  "htmlBody" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "forwardedAt" TIMESTAMP(3),
  "attachmentCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OutreachReply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutreachReply_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "OutreachRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachReply_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OutreachReply_providerEmailId_key" ON "OutreachReply"("providerEmailId");
CREATE INDEX "OutreachReply_contactId_receivedAt_idx" ON "OutreachReply"("contactId", "receivedAt");
CREATE INDEX "OutreachReply_recipientId_receivedAt_idx" ON "OutreachReply"("recipientId", "receivedAt");
