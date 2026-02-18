-- CreateTable
CREATE TABLE "CommunityComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ticketId" TEXT,
    "eventId" TEXT,
    "parentId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    CONSTRAINT "CommunityComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommunityComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CommunityComment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CommunityComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommunityComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CommunityComment_createdAt_idx" ON "CommunityComment"("createdAt");

-- CreateIndex
CREATE INDEX "CommunityComment_userId_createdAt_idx" ON "CommunityComment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityComment_ticketId_createdAt_idx" ON "CommunityComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityComment_eventId_createdAt_idx" ON "CommunityComment"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityComment_parentId_createdAt_idx" ON "CommunityComment"("parentId", "createdAt");
