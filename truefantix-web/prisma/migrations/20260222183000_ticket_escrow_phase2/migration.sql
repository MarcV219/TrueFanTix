CREATE TABLE "TicketEscrow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "orderId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'NONE',
    "provider" TEXT,
    "providerRef" TEXT,
    "releasedTo" TEXT,
    "failureReason" TEXT,
    "depositedAt" DATETIME,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TicketEscrow_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketEscrow_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TicketEscrow_ticketId_key" ON "TicketEscrow"("ticketId");
CREATE INDEX "TicketEscrow_state_updatedAt_idx" ON "TicketEscrow"("state", "updatedAt");
CREATE INDEX "TicketEscrow_orderId_idx" ON "TicketEscrow"("orderId");
