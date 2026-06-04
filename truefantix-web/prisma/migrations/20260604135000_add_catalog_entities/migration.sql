-- CreateTable
CREATE TABLE "CatalogEntity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "aliases" TEXT,
    "subtitle" TEXT,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "sourceUrl" TEXT,
    "metadata" TEXT,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogEntity_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN "catalogEntityId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CatalogEntity_provider_providerId_type_key" ON "CatalogEntity"("provider", "providerId", "type");

-- CreateIndex
CREATE INDEX "CatalogEntity_type_canonicalName_idx" ON "CatalogEntity"("type", "canonicalName");

-- CreateIndex
CREATE INDEX "CatalogEntity_type_city_region_country_idx" ON "CatalogEntity"("type", "city", "region", "country");

-- CreateIndex
CREATE INDEX "CatalogEntity_lastSeenAt_idx" ON "CatalogEntity"("lastSeenAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_catalogEntityId_idx" ON "NotificationPreference"("catalogEntityId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_catalogEntityId_fkey" FOREIGN KEY ("catalogEntityId") REFERENCES "CatalogEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
