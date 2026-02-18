-- CreateTable
CREATE TABLE "ForumThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "topicType" TEXT NOT NULL DEFAULT 'OTHER',
    "topic" TEXT,
    "authorUserId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'VISIBLE',
    "visibilityReason" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" DATETIME,
    "lockedReason" TEXT,
    CONSTRAINT "ForumThread_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'VISIBLE',
    "visibilityReason" TEXT,
    CONSTRAINT "ForumPost_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ForumThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumPost_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ForumThread_createdAt_idx" ON "ForumThread"("createdAt");

-- CreateIndex
CREATE INDEX "ForumThread_topicType_createdAt_idx" ON "ForumThread"("topicType", "createdAt");

-- CreateIndex
CREATE INDEX "ForumThread_topic_createdAt_idx" ON "ForumThread"("topic", "createdAt");

-- CreateIndex
CREATE INDEX "ForumThread_visibility_createdAt_idx" ON "ForumThread"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "ForumThread_authorUserId_createdAt_idx" ON "ForumThread"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_threadId_createdAt_idx" ON "ForumPost"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_parentId_createdAt_idx" ON "ForumPost"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_authorUserId_createdAt_idx" ON "ForumPost"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_visibility_createdAt_idx" ON "ForumPost"("visibility", "createdAt");
