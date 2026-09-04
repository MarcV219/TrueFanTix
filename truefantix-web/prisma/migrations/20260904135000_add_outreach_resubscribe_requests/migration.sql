CREATE TABLE "OutreachResubscribeRequest" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "normalizedEmail" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "requestIp" TEXT,

  CONSTRAINT "OutreachResubscribeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachResubscribeRequest_tokenHash_key"
ON "OutreachResubscribeRequest"("tokenHash");

CREATE INDEX "OutreachResubscribeRequest_normalizedEmail_createdAt_idx"
ON "OutreachResubscribeRequest"("normalizedEmail", "createdAt");

CREATE INDEX "OutreachResubscribeRequest_expiresAt_confirmedAt_idx"
ON "OutreachResubscribeRequest"("expiresAt", "confirmedAt");
