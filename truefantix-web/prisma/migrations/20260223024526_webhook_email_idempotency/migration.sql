-- CreateTable
CREATE TABLE "EventDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "EventDelivery_eventId_key" ON "EventDelivery"("eventId");

-- CreateIndex
CREATE INDEX "EventDelivery_eventId_idx" ON "EventDelivery"("eventId");

-- CreateIndex
CREATE INDEX "EventDelivery_orderId_idx" ON "EventDelivery"("orderId");

-- CreateIndex
CREATE INDEX "EmailDelivery_orderId_idx" ON "EmailDelivery"("orderId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_idx" ON "EmailDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_orderId_emailType_recipient_key" ON "EmailDelivery"("orderId", "emailType", "recipient");
