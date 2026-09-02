CREATE TABLE "OutreachEmailEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "svixId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "detail" TEXT,
  CONSTRAINT "OutreachEmailEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachEmailEvent_svixId_key" ON "OutreachEmailEvent"("svixId");
CREATE INDEX "OutreachEmailEvent_recipientId_occurredAt_idx" ON "OutreachEmailEvent"("recipientId", "occurredAt");
CREATE INDEX "OutreachEmailEvent_providerMessageId_idx" ON "OutreachEmailEvent"("providerMessageId");
CREATE INDEX "OutreachEmailEvent_type_occurredAt_idx" ON "OutreachEmailEvent"("type", "occurredAt");

ALTER TABLE "OutreachEmailEvent" ADD CONSTRAINT "OutreachEmailEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "OutreachRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
