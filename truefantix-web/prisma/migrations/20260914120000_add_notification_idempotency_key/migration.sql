-- Existing notification history has no durable idempotency identity. Preserve
-- every row as legacy NULL history while allowing narrowly scoped writers to
-- serialize on a canonical key going forward.
ALTER TABLE "Notification"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Notification_idempotencyKey_key"
ON "Notification"("idempotencyKey");
