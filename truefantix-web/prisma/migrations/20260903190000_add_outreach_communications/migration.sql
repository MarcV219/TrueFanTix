CREATE TABLE "OutreachCommunication" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "OutreachCommunication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutreachCommunication_contactId_occurredAt_idx" ON "OutreachCommunication"("contactId", "occurredAt");
ALTER TABLE "OutreachCommunication" ADD CONSTRAINT "OutreachCommunication_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
