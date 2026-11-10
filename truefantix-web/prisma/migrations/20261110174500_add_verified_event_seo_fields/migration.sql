ALTER TABLE "Event"
ADD COLUMN "description" TEXT,
ADD COLUMN "organizerName" TEXT,
ADD COLUMN "performerName" TEXT,
ADD COLUMN "endDate" TEXT,
ADD COLUMN "seoSourceUrl" TEXT,
ADD COLUMN "seoVerifiedAt" TIMESTAMP(3);
