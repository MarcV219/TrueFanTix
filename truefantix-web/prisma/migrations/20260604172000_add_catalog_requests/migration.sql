CREATE TABLE "CatalogRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedType" TEXT NOT NULL,
    "requestedValue" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "resolvedCatalogEntityId" TEXT,
    "fulfilledPreferenceId" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogRequest_userId_requestedType_requestedValue_key" ON "CatalogRequest"("userId", "requestedType", "requestedValue");
CREATE INDEX "CatalogRequest_status_createdAt_idx" ON "CatalogRequest"("status", "createdAt");
CREATE INDEX "CatalogRequest_requestedType_requestedValue_idx" ON "CatalogRequest"("requestedType", "requestedValue");
CREATE INDEX "CatalogRequest_resolvedCatalogEntityId_idx" ON "CatalogRequest"("resolvedCatalogEntityId");

ALTER TABLE "CatalogRequest" ADD CONSTRAINT "CatalogRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogRequest" ADD CONSTRAINT "CatalogRequest_resolvedCatalogEntityId_fkey" FOREIGN KEY ("resolvedCatalogEntityId") REFERENCES "CatalogEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
