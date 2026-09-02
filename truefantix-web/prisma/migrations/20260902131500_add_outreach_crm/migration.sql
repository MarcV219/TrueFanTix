CREATE TABLE "OutreachContact" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "externalKey" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "organization" TEXT,
  "subjectName" TEXT,
  "contactName" TEXT,
  "role" TEXT,
  "email" TEXT,
  "normalizedEmail" TEXT,
  "phone" TEXT,
  "websiteUrl" TEXT,
  "sourceUrl" TEXT,
  "sourceType" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "confidence" TEXT,
  "researchStatus" TEXT,
  "notes" TEXT,
  "consentBasis" TEXT NOT NULL DEFAULT 'UNASSESSED',
  "consentEvidence" TEXT,
  "consentExpiresAt" TIMESTAMP(3),
  "lastContactedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  CONSTRAINT "OutreachContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachSuppression" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "notes" TEXT,
  "suppressedById" TEXT,
  CONSTRAINT "OutreachSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachTemplate" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "bodyHtml" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "OutreachTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachCampaign" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "templateId" TEXT,
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "bodyHtml" TEXT,
  "createdById" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OutreachCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachRecipient" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "emailSnapshot" TEXT NOT NULL,
  "subjectSnapshot" TEXT NOT NULL,
  "bodyTextSnapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "gmailMessageId" TEXT,
  "gmailThreadId" TEXT,
  "providerResult" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  CONSTRAINT "OutreachRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachContact_externalKey_key" ON "OutreachContact"("externalKey");
CREATE INDEX "OutreachContact_category_organization_idx" ON "OutreachContact"("category", "organization");
CREATE INDEX "OutreachContact_normalizedEmail_idx" ON "OutreachContact"("normalizedEmail");
CREATE INDEX "OutreachContact_researchStatus_confidence_idx" ON "OutreachContact"("researchStatus", "confidence");
CREATE INDEX "OutreachContact_consentBasis_consentExpiresAt_idx" ON "OutreachContact"("consentBasis", "consentExpiresAt");
CREATE INDEX "OutreachContact_lastContactedAt_idx" ON "OutreachContact"("lastContactedAt");
CREATE UNIQUE INDEX "OutreachSuppression_normalizedEmail_key" ON "OutreachSuppression"("normalizedEmail");
CREATE INDEX "OutreachSuppression_createdAt_idx" ON "OutreachSuppression"("createdAt");
CREATE UNIQUE INDEX "OutreachTemplate_name_key" ON "OutreachTemplate"("name");
CREATE INDEX "OutreachTemplate_isArchived_updatedAt_idx" ON "OutreachTemplate"("isArchived", "updatedAt");
CREATE INDEX "OutreachCampaign_status_createdAt_idx" ON "OutreachCampaign"("status", "createdAt");
CREATE INDEX "OutreachCampaign_createdById_createdAt_idx" ON "OutreachCampaign"("createdById", "createdAt");
CREATE UNIQUE INDEX "OutreachRecipient_campaignId_contactId_key" ON "OutreachRecipient"("campaignId", "contactId");
CREATE INDEX "OutreachRecipient_status_createdAt_idx" ON "OutreachRecipient"("status", "createdAt");
CREATE INDEX "OutreachRecipient_contactId_sentAt_idx" ON "OutreachRecipient"("contactId", "sentAt");
CREATE INDEX "OutreachRecipient_gmailThreadId_idx" ON "OutreachRecipient"("gmailThreadId");
ALTER TABLE "OutreachCampaign" ADD CONSTRAINT "OutreachCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OutreachTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutreachRecipient" ADD CONSTRAINT "OutreachRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachRecipient" ADD CONSTRAINT "OutreachRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
