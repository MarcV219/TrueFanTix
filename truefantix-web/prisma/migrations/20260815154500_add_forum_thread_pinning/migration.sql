ALTER TABLE "ForumThread"
ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "ForumThread_isPinned_pinnedAt_idx"
ON "ForumThread"("isPinned", "pinnedAt");
