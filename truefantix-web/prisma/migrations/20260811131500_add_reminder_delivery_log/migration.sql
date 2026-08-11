CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerResult" TEXT,
    "failureReason" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReminderDelivery_attemptedAt_idx" ON "ReminderDelivery"("attemptedAt");
CREATE INDEX "ReminderDelivery_status_attemptedAt_idx" ON "ReminderDelivery"("status", "attemptedAt");
CREATE INDEX "ReminderDelivery_orderId_attemptedAt_idx" ON "ReminderDelivery"("orderId", "attemptedAt");
CREATE UNIQUE INDEX "ReminderDelivery_orderId_reminderType_recipient_windowStart_key" ON "ReminderDelivery"("orderId", "reminderType", "recipient", "windowStart");
