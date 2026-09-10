-- Primary ticketing foundation only. This migration intentionally excludes
-- inventory, checkout, credentials, scanning, refunds, and settlement.

CREATE TYPE "PrimaryOrganizerStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "PrimaryOrganizerPaymentStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'RESTRICTED');
CREATE TYPE "PrimaryMembershipRole" AS ENUM ('OWNER', 'FINANCE', 'EVENT_MANAGER', 'BOX_OFFICE', 'SCANNER', 'READ_ONLY');
CREATE TYPE "PrimaryMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');
CREATE TYPE "PrimaryEventStaffAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "PrimaryAuditActorType" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "PrimaryOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

CREATE TABLE "PrimaryOrganizer" (
  "id" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "businessNumberEncrypted" TEXT,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "supportEmail" TEXT NOT NULL,
  "supportPhone" TEXT,
  "website" TEXT,
  "status" "PrimaryOrganizerStatus" NOT NULL DEFAULT 'DRAFT',
  "statusReason" TEXT,
  "paymentProvider" TEXT,
  "paymentAccountRefEncrypted" TEXT,
  "paymentStatus" "PrimaryOrganizerPaymentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  CONSTRAINT "PrimaryOrganizer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryOrganizerMembership" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "PrimaryMembershipRole" NOT NULL,
  "status" "PrimaryMembershipStatus" NOT NULL DEFAULT 'INVITED',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  CONSTRAINT "PrimaryOrganizerMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryOrganizerInvitation" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "role" "PrimaryMembershipRole" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  CONSTRAINT "PrimaryOrganizerInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryEvent" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryEventStaffAssignment" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "status" "PrimaryEventStaffAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "revokedByUserId" TEXT,
  CONSTRAINT "PrimaryEventStaffAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryAuditEvent" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT,
  "eventId" TEXT,
  "actorUserId" TEXT,
  "actorType" "PrimaryAuditActorType" NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "reason" TEXT,
  "requestId" TEXT,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimaryAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrimaryOutboxMessage" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT,
  "topic" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "status" "PrimaryOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processingAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrimaryOutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrimaryOrganizer_status_createdAt_idx" ON "PrimaryOrganizer"("status", "createdAt");
CREATE INDEX "PrimaryOrganizer_createdByUserId_idx" ON "PrimaryOrganizer"("createdByUserId");
CREATE UNIQUE INDEX "PrimaryOrganizerMembership_organizerId_userId_key" ON "PrimaryOrganizerMembership"("organizerId", "userId");
CREATE UNIQUE INDEX "PrimaryOrganizerMembership_id_organizerId_key" ON "PrimaryOrganizerMembership"("id", "organizerId");
CREATE INDEX "PrimaryOrganizerMembership_userId_status_idx" ON "PrimaryOrganizerMembership"("userId", "status");
CREATE INDEX "PrimaryOrganizerMembership_organizerId_role_status_idx" ON "PrimaryOrganizerMembership"("organizerId", "role", "status");
CREATE UNIQUE INDEX "PrimaryOrganizerInvitation_tokenHash_key" ON "PrimaryOrganizerInvitation"("tokenHash");
CREATE INDEX "PrimaryOrganizerInvitation_organizerId_emailNormalized_idx" ON "PrimaryOrganizerInvitation"("organizerId", "emailNormalized");
CREATE INDEX "PrimaryOrganizerInvitation_emailNormalized_expiresAt_idx" ON "PrimaryOrganizerInvitation"("emailNormalized", "expiresAt");
CREATE UNIQUE INDEX "PrimaryEvent_id_organizerId_key" ON "PrimaryEvent"("id", "organizerId");
CREATE INDEX "PrimaryEvent_organizerId_idx" ON "PrimaryEvent"("organizerId");
CREATE UNIQUE INDEX "PrimaryEventStaffAssignment_eventId_membershipId_key" ON "PrimaryEventStaffAssignment"("eventId", "membershipId");
CREATE INDEX "PrimaryEventStaffAssignment_membershipId_status_idx" ON "PrimaryEventStaffAssignment"("membershipId", "status");
CREATE INDEX "PrimaryEventStaffAssignment_organizerId_eventId_status_idx" ON "PrimaryEventStaffAssignment"("organizerId", "eventId", "status");
CREATE INDEX "PrimaryAuditEvent_organizerId_createdAt_idx" ON "PrimaryAuditEvent"("organizerId", "createdAt");
CREATE INDEX "PrimaryAuditEvent_eventId_createdAt_idx" ON "PrimaryAuditEvent"("eventId", "createdAt");
CREATE INDEX "PrimaryAuditEvent_targetType_targetId_createdAt_idx" ON "PrimaryAuditEvent"("targetType", "targetId", "createdAt");
CREATE INDEX "PrimaryAuditEvent_actorUserId_createdAt_idx" ON "PrimaryAuditEvent"("actorUserId", "createdAt");
CREATE UNIQUE INDEX "PrimaryOutboxMessage_idempotencyKey_key" ON "PrimaryOutboxMessage"("idempotencyKey");
CREATE INDEX "PrimaryOutboxMessage_status_availableAt_idx" ON "PrimaryOutboxMessage"("status", "availableAt");
CREATE INDEX "PrimaryOutboxMessage_organizerId_createdAt_idx" ON "PrimaryOutboxMessage"("organizerId", "createdAt");
CREATE INDEX "PrimaryOutboxMessage_aggregateType_aggregateId_idx" ON "PrimaryOutboxMessage"("aggregateType", "aggregateId");

ALTER TABLE "PrimaryOrganizer" ADD CONSTRAINT "PrimaryOrganizer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrganizer" ADD CONSTRAINT "PrimaryOrganizer_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrganizerMembership" ADD CONSTRAINT "PrimaryOrganizerMembership_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "PrimaryOrganizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrganizerMembership" ADD CONSTRAINT "PrimaryOrganizerMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrganizerMembership" ADD CONSTRAINT "PrimaryOrganizerMembership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrganizerInvitation" ADD CONSTRAINT "PrimaryOrganizerInvitation_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "PrimaryOrganizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryOrganizerInvitation" ADD CONSTRAINT "PrimaryOrganizerInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryEvent" ADD CONSTRAINT "PrimaryEvent_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "PrimaryOrganizer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryEventStaffAssignment" ADD CONSTRAINT "PrimaryEventStaffAssignment_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryEventStaffAssignment" ADD CONSTRAINT "PrimaryEventStaffAssignment_membershipId_organizerId_fkey" FOREIGN KEY ("membershipId", "organizerId") REFERENCES "PrimaryOrganizerMembership"("id", "organizerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrimaryEventStaffAssignment" ADD CONSTRAINT "PrimaryEventStaffAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrimaryEventStaffAssignment" ADD CONSTRAINT "PrimaryEventStaffAssignment_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrimaryAuditEvent" ADD CONSTRAINT "PrimaryAuditEvent_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "PrimaryOrganizer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrimaryAuditEvent" ADD CONSTRAINT "PrimaryAuditEvent_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrimaryAuditEvent" ADD CONSTRAINT "PrimaryAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrimaryOutboxMessage" ADD CONSTRAINT "PrimaryOutboxMessage_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "PrimaryOrganizer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
