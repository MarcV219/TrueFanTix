CREATE TABLE "ProductionIncident" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "safeDetails" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAlertedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  CONSTRAINT "ProductionIncident_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionIncident_fingerprint_key" ON "ProductionIncident"("fingerprint");
CREATE INDEX "ProductionIncident_status_severity_lastSeenAt_idx" ON "ProductionIncident"("status", "severity", "lastSeenAt");
CREATE INDEX "ProductionIncident_category_lastSeenAt_idx" ON "ProductionIncident"("category", "lastSeenAt");
