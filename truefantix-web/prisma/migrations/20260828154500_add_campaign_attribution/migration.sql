ALTER TABLE "User"
ADD COLUMN "acquisitionSource" TEXT,
ADD COLUMN "acquisitionMedium" TEXT,
ADD COLUMN "acquisitionCampaign" TEXT,
ADD COLUMN "acquisitionContent" TEXT,
ADD COLUMN "acquisitionTerm" TEXT,
ADD COLUMN "acquisitionFirstPath" TEXT,
ADD COLUMN "acquisitionReferrerHost" TEXT;

ALTER TABLE "TrafficVisitorDay"
ADD COLUMN "medium" TEXT,
ADD COLUMN "content" TEXT,
ADD COLUMN "term" TEXT;

CREATE INDEX "User_acquisitionSource_acquisitionCampaign_createdAt_idx"
ON "User"("acquisitionSource", "acquisitionCampaign", "createdAt");
