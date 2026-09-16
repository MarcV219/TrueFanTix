ALTER TABLE "OutreachRecipient"
ADD COLUMN "deliveryAttemptId" TEXT;

CREATE UNIQUE INDEX "OutreachRecipient_deliveryAttemptId_key"
ON "OutreachRecipient"("deliveryAttemptId");

DROP INDEX IF EXISTS "OutreachRecipient_providerMessageId_idx";
CREATE UNIQUE INDEX "OutreachRecipient_providerMessageId_key"
ON "OutreachRecipient"("providerMessageId");

CREATE TABLE "OutreachQuarantinedEmailEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "svixId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "deliveryAttemptId" TEXT,
  "email" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "detail" TEXT,
  "reason" TEXT NOT NULL,
  "deleteAfter" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachQuarantinedEmailEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachQuarantinedEmailEvent_svixId_key"
ON "OutreachQuarantinedEmailEvent"("svixId");

CREATE INDEX "OutreachQuarantinedEmailEvent_deleteAfter_idx"
ON "OutreachQuarantinedEmailEvent"("deleteAfter");

CREATE INDEX "OutreachQuarantinedEmailEvent_providerMessageId_occurredAt_idx"
ON "OutreachQuarantinedEmailEvent"("providerMessageId", "occurredAt");

CREATE TABLE "OutreachEmailEventTombstone" (
  "svixId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutreachEmailEventTombstone_pkey" PRIMARY KEY ("svixId")
);

CREATE OR REPLACE FUNCTION protect_outreach_delivery_attempt()
RETURNS trigger AS $$
BEGIN
  IF OLD."deliveryAttemptId" IS NOT NULL
    AND NEW."deliveryAttemptId" IS DISTINCT FROM OLD."deliveryAttemptId" THEN
    RAISE EXCEPTION 'Outreach delivery attempt identity is immutable';
  END IF;

  IF OLD."providerMessageId" IS NOT NULL
    AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId" THEN
    RAISE EXCEPTION 'Outreach provider message identity is immutable';
  END IF;

  IF OLD."deliveryAttemptId" IS NOT NULL
    AND NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'Claimed outreach delivery cannot return to pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OutreachRecipient_protect_delivery_attempt"
BEFORE UPDATE ON "OutreachRecipient"
FOR EACH ROW EXECUTE FUNCTION protect_outreach_delivery_attempt();
