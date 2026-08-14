CREATE TABLE "TrafficVisitorDay" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "visitorId" TEXT NOT NULL,
    "pageViews" INTEGER NOT NULL DEFAULT 1,
    "firstPath" TEXT NOT NULL,
    "referrerHost" TEXT,
    "source" TEXT,
    "campaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficVisitorDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrafficVisitorDay_day_visitorId_key" ON "TrafficVisitorDay"("day", "visitorId");
CREATE INDEX "TrafficVisitorDay_day_idx" ON "TrafficVisitorDay"("day");
CREATE INDEX "TrafficVisitorDay_source_day_idx" ON "TrafficVisitorDay"("source", "day");
