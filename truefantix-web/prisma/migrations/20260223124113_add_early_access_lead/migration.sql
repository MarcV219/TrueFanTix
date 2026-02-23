-- CreateTable
CREATE TABLE "EarlyAccessLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'homepage'
);

-- CreateIndex
CREATE UNIQUE INDEX "EarlyAccessLead_email_key" ON "EarlyAccessLead"("email");

-- CreateIndex
CREATE INDEX "EarlyAccessLead_createdAt_idx" ON "EarlyAccessLead"("createdAt");
