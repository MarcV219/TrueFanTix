-- CreateEnum
CREATE TYPE "PrimaryPolicyLiabilityOwner" AS ENUM ('ORGANIZER', 'TRUEFANTIX');

-- CreateEnum
CREATE TYPE "PrimaryRefundStatus" AS ENUM ('REQUESTED', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED', 'CANCELLED_BEFORE_PROVIDER');

-- CreateEnum
CREATE TYPE "PrimaryRefundAttemptStatus" AS ENUM ('NOT_SENT', 'SEND_UNCERTAIN', 'PROVIDER_ATTACHED', 'TERMINAL_FAILED', 'SUCCEEDED');

-- CreateEnum
CREATE TYPE "PrimaryCancellationStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'REFUNDING', 'RESOLVED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "PrimaryRefundObligationStatus" AS ENUM ('OPEN', 'REFUND_LINKED', 'SATISFIED', 'WAIVED_WITH_APPROVAL', 'RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "PrimaryRefundPolicyVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "policyDigest" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "merchantOfRecord" TEXT NOT NULL,
    "proceedsReleaseRule" TEXT NOT NULL,
    "checkedInRefundRule" TEXT NOT NULL,
    "inventoryReturnRule" TEXT NOT NULL,
    "chargebackRule" TEXT NOT NULL,
    "privacyAccountingRule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryPurchaseAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderComponentId" TEXT NOT NULL,
    "admissionTicketId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refundable" BOOLEAN NOT NULL,
    "liabilityOwner" "PrimaryPolicyLiabilityOwner" NOT NULL,
    "remainderRank" INTEGER NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "allocationSetDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryPurchaseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryRefund" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentAttemptId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "status" "PrimaryRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestKey" TEXT NOT NULL,
    "commandDigest" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "finalityReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrimaryRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryRefundItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "admissionTicketId" TEXT NOT NULL,
    "requestedMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryRefundAllocation" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "refundItemId" TEXT NOT NULL,
    "admissionTicketId" TEXT NOT NULL,
    "purchaseAllocationId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryRefundProviderAttempt" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "PrimaryRefundAttemptStatus" NOT NULL DEFAULT 'NOT_SENT',
    "providerKey" TEXT NOT NULL,
    "expectedAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "authorizationKey" TEXT NOT NULL,
    "authorizationDigest" TEXT NOT NULL,
    "authorizedByUserId" TEXT NOT NULL,
    "authorizationReason" TEXT NOT NULL,
    "terminalEvidenceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryRefundProviderEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryEventCancellation" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" "PrimaryCancellationStatus" NOT NULL DEFAULT 'REQUESTED',
    "policyVersionId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "commandDigest" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshotMaxTicketId" TEXT NOT NULL,
    "expectedTicketCount" INTEGER NOT NULL,
    "expectedAmountMinor" INTEGER NOT NULL,
    "processedTicketCount" INTEGER NOT NULL DEFAULT 0,
    "processedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrimaryEventCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryCancellationBatch" (
    "id" TEXT NOT NULL,
    "cancellationId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "commandDigest" TEXT NOT NULL,
    "firstTicketId" TEXT NOT NULL,
    "lastTicketId" TEXT NOT NULL,
    "processedTicketCount" INTEGER NOT NULL,
    "processedAmountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryCancellationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryRefundObligation" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cancellationId" TEXT,
    "refundId" TEXT,
    "status" "PrimaryRefundObligationStatus" NOT NULL DEFAULT 'OPEN',
    "cause" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryRefundObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryAdmissionRevocation" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "admissionTicketId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "refundId" TEXT,
    "cancellationId" TEXT,
    "policyVersionId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "cause" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryAdmissionRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundPolicyVersion_version_key" ON "PrimaryRefundPolicyVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundPolicyVersion_policyDigest_key" ON "PrimaryRefundPolicyVersion"("policyDigest");

-- CreateIndex
CREATE INDEX "PrimaryPurchaseAllocation_orderId_admissionTicketId_idx" ON "PrimaryPurchaseAllocation"("orderId", "admissionTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryPurchaseAllocation_orderComponentId_admissionTicketI_key" ON "PrimaryPurchaseAllocation"("orderComponentId", "admissionTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryPurchaseAllocation_id_orderId_admissionTicketId_key" ON "PrimaryPurchaseAllocation"("id", "orderId", "admissionTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefund_requestKey_key" ON "PrimaryRefund"("requestKey");

-- CreateIndex
CREATE INDEX "PrimaryRefund_organizerId_eventId_status_idx" ON "PrimaryRefund"("organizerId", "eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefund_id_organizerId_eventId_orderId_paymentAttempt_key" ON "PrimaryRefund"("id", "organizerId", "eventId", "orderId", "paymentAttemptId");

-- CreateIndex
CREATE INDEX "PrimaryRefundItem_admissionTicketId_idx" ON "PrimaryRefundItem"("admissionTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundItem_refundId_admissionTicketId_key" ON "PrimaryRefundItem"("refundId", "admissionTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundItem_id_refundId_admissionTicketId_key" ON "PrimaryRefundItem"("id", "refundId", "admissionTicketId");

-- CreateIndex
CREATE INDEX "PrimaryRefundAllocation_refundItemId_idx" ON "PrimaryRefundAllocation"("refundItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundAllocation_refundId_purchaseAllocationId_key" ON "PrimaryRefundAllocation"("refundId", "purchaseAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundProviderAttempt_providerKey_key" ON "PrimaryRefundProviderAttempt"("providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundProviderAttempt_providerRefundId_key" ON "PrimaryRefundProviderAttempt"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundProviderAttempt_authorizationKey_key" ON "PrimaryRefundProviderAttempt"("authorizationKey");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundProviderAttempt_refundId_ordinal_key" ON "PrimaryRefundProviderAttempt"("refundId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundProviderEvent_providerEventId_key" ON "PrimaryRefundProviderEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "PrimaryRefundProviderEvent_attemptId_providerCreatedAt_idx" ON "PrimaryRefundProviderEvent"("attemptId", "providerCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryEventCancellation_requestKey_key" ON "PrimaryEventCancellation"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryEventCancellation_eventId_generation_key" ON "PrimaryEventCancellation"("eventId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryEventCancellation_id_organizerId_eventId_key" ON "PrimaryEventCancellation"("id", "organizerId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryCancellationBatch_batchKey_key" ON "PrimaryCancellationBatch"("batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryCancellationBatch_cancellationId_firstTicketId_lastT_key" ON "PrimaryCancellationBatch"("cancellationId", "firstTicketId", "lastTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryRefundObligation_idempotencyKey_key" ON "PrimaryRefundObligation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrimaryRefundObligation_organizerId_eventId_status_idx" ON "PrimaryRefundObligation"("organizerId", "eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryAdmissionRevocation_idempotencyKey_key" ON "PrimaryAdmissionRevocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrimaryAdmissionRevocation_organizerId_eventId_effectiveAt_idx" ON "PrimaryAdmissionRevocation"("organizerId", "eventId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryAdmissionRevocation_admissionTicketId_cause_refundId_key" ON "PrimaryAdmissionRevocation"("admissionTicketId", "cause", "refundId", "cancellationId");

-- AddForeignKey
ALTER TABLE "PrimaryPurchaseAllocation" ADD CONSTRAINT "PrimaryPurchaseAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PrimaryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryPurchaseAllocation" ADD CONSTRAINT "PrimaryPurchaseAllocation_orderComponentId_fkey" FOREIGN KEY ("orderComponentId") REFERENCES "PrimaryOrderPriceComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryPurchaseAllocation" ADD CONSTRAINT "PrimaryPurchaseAllocation_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryPurchaseAllocation" ADD CONSTRAINT "PrimaryPurchaseAllocation_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PrimaryRefundPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefund" ADD CONSTRAINT "PrimaryRefund_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefund" ADD CONSTRAINT "PrimaryRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PrimaryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefund" ADD CONSTRAINT "PrimaryRefund_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PrimaryPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefund" ADD CONSTRAINT "PrimaryRefund_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefund" ADD CONSTRAINT "PrimaryRefund_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PrimaryRefundPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundItem" ADD CONSTRAINT "PrimaryRefundItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundItem" ADD CONSTRAINT "PrimaryRefundItem_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundAllocation" ADD CONSTRAINT "PrimaryRefundAllocation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundAllocation" ADD CONSTRAINT "PrimaryRefundAllocation_refundItemId_refundId_admissionTic_fkey" FOREIGN KEY ("refundItemId", "refundId", "admissionTicketId") REFERENCES "PrimaryRefundItem"("id", "refundId", "admissionTicketId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundAllocation" ADD CONSTRAINT "PrimaryRefundAllocation_purchaseAllocationId_fkey" FOREIGN KEY ("purchaseAllocationId") REFERENCES "PrimaryPurchaseAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundProviderAttempt" ADD CONSTRAINT "PrimaryRefundProviderAttempt_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundProviderAttempt" ADD CONSTRAINT "PrimaryRefundProviderAttempt_authorizedByUserId_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundProviderEvent" ADD CONSTRAINT "PrimaryRefundProviderEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PrimaryRefundProviderAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryEventCancellation" ADD CONSTRAINT "PrimaryEventCancellation_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryEventCancellation" ADD CONSTRAINT "PrimaryEventCancellation_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PrimaryRefundPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryEventCancellation" ADD CONSTRAINT "PrimaryEventCancellation_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryCancellationBatch" ADD CONSTRAINT "PrimaryCancellationBatch_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "PrimaryEventCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundObligation" ADD CONSTRAINT "PrimaryRefundObligation_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundObligation" ADD CONSTRAINT "PrimaryRefundObligation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PrimaryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundObligation" ADD CONSTRAINT "PrimaryRefundObligation_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "PrimaryEventCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryRefundObligation" ADD CONSTRAINT "PrimaryRefundObligation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_eventId_organizerId_fkey" FOREIGN KEY ("eventId", "organizerId") REFERENCES "PrimaryEvent"("id", "organizerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_admissionTicketId_fkey" FOREIGN KEY ("admissionTicketId") REFERENCES "PrimaryAdmissionTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "PrimaryAdmissionCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PrimaryRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "PrimaryEventCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PrimaryRefundPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Policy v1 is immutable and prospective. Existing synthetic orders are assigned
-- this version without rewriting their purchase snapshots.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO "PrimaryRefundPolicyVersion" (
  "id", "version", "policyDigest", "effectiveAt", "merchantOfRecord",
  "proceedsReleaseRule", "checkedInRefundRule", "inventoryReturnRule",
  "chargebackRule", "privacyAccountingRule"
) VALUES (
  'primary-refund-policy-v1', 1,
  encode(digest('primary-refund-policy-v1-organizer-mor-component-liability-supervised-checked-in-hold-through-clearance-no-auto-resale-organizer-chargeback-immutable-accounting', 'sha256'), 'hex'),
  TIMESTAMP '2026-09-11 00:00:00',
  'ORGANIZER_CONTRACTUAL_SELLER_TRUEFANTIX_SEPARATE_ADMIN_FEE',
  'HOLD_UNTIL_EVENT_COMPLETION_THEN_CLEARANCE_AND_RISK_RESERVE',
  'SUPERVISED_EXCEPTION_REVIEW_ONLY',
  'NO_AUTOMATIC_RETURN_RESALE_REQUIRES_VERSIONED_REISSUE',
  'ORGANIZER_PRINCIPAL_AND_FEES_EXCEPT_TRUEFANTIX_CAUSED_ERROR',
  'IMMUTABLE_ACCOUNTING_NOTICES_TAX_CORRECTIONS_LEAST_PRIVILEGE_LEGAL_HOLDS_RETENTION_CONTROLLER_PROCESSOR_SPLIT'
);

ALTER TABLE "PrimaryRefundPolicyVersion" ADD CONSTRAINT "PrimaryRefundPolicyVersion_values_check" CHECK (
  "version" > 0 AND "policyDigest" ~ '^[0-9a-f]{64}$' AND
  length(btrim("merchantOfRecord")) > 0 AND length(btrim("proceedsReleaseRule")) > 0 AND
  length(btrim("checkedInRefundRule")) > 0 AND length(btrim("inventoryReturnRule")) > 0 AND
  length(btrim("chargebackRule")) > 0 AND length(btrim("privacyAccountingRule")) > 0
);
ALTER TABLE "PrimaryPurchaseAllocation" ADD CONSTRAINT "PrimaryPurchaseAllocation_values_check" CHECK (
  "amountMinor" >= 0 AND "remainderRank" > 0 AND "algorithmVersion" = 1 AND
  "currency" ~ '^[A-Z]{3}$' AND "allocationSetDigest" ~ '^[0-9a-f]{64}$'
);
ALTER TABLE "PrimaryRefund" ADD CONSTRAINT "PrimaryRefund_values_check" CHECK (
  "requestedAmountMinor" > 0 AND "currency" ~ '^[A-Z]{3}$' AND
  "commandDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("reason")) > 0 AND
  (("status" = 'FAILED' AND length(btrim("finalityReason")) > 0) OR ("status" <> 'FAILED' AND "finalityReason" IS NULL))
);
ALTER TABLE "PrimaryRefundItem" ADD CONSTRAINT "PrimaryRefundItem_values_check" CHECK ("requestedMinor" > 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "PrimaryRefundAllocation" ADD CONSTRAINT "PrimaryRefundAllocation_values_check" CHECK ("amountMinor" > 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "PrimaryRefundProviderAttempt" ADD CONSTRAINT "PrimaryRefundProviderAttempt_values_check" CHECK (
  "ordinal" > 0 AND "expectedAmountMinor" > 0 AND "currency" ~ '^[A-Z]{3}$' AND
  "authorizationDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("authorizationReason")) > 0 AND
  (("status" = 'TERMINAL_FAILED' AND "terminalEvidenceHash" ~ '^[0-9a-f]{64}$') OR "status" <> 'TERMINAL_FAILED')
);
ALTER TABLE "PrimaryRefundProviderEvent" ADD CONSTRAINT "PrimaryRefundProviderEvent_values_check" CHECK ("payloadDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("eventType")) > 0);
ALTER TABLE "PrimaryEventCancellation" ADD CONSTRAINT "PrimaryEventCancellation_values_check" CHECK (
  "generation" > 0 AND "commandDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("reason")) > 0 AND
  "expectedTicketCount" >= 0 AND "expectedAmountMinor" >= 0 AND "processedTicketCount" >= 0 AND "processedAmountMinor" >= 0 AND
  "processedTicketCount" <= "expectedTicketCount" AND "processedAmountMinor" <= "expectedAmountMinor" AND
  (("status" = 'REQUESTED' AND "activatedAt" IS NULL) OR ("status" <> 'REQUESTED' AND "activatedAt" IS NOT NULL))
);
ALTER TABLE "PrimaryCancellationBatch" ADD CONSTRAINT "PrimaryCancellationBatch_values_check" CHECK (
  "commandDigest" ~ '^[0-9a-f]{64}$' AND "processedTicketCount" > 0 AND "processedAmountMinor" >= 0 AND "firstTicketId" <= "lastTicketId"
);
ALTER TABLE "PrimaryRefundObligation" ADD CONSTRAINT "PrimaryRefundObligation_values_check" CHECK (
  "amountMinor" > 0 AND "currency" ~ '^[A-Z]{3}$' AND length(btrim("cause")) > 0 AND length(btrim("reason")) > 0 AND
  ("cancellationId" IS NOT NULL OR "refundId" IS NOT NULL)
);
ALTER TABLE "PrimaryAdmissionRevocation" ADD CONSTRAINT "PrimaryAdmissionRevocation_values_check" CHECK (
  length(btrim("cause")) > 0 AND length(btrim("reason")) > 0 AND ("refundId" IS NOT NULL OR "cancellationId" IS NOT NULL)
);

-- Exact component/ticket scope is enforced independently of application code.
CREATE OR REPLACE FUNCTION validate_primary_refund_scope() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'PrimaryPurchaseAllocation' THEN
    IF NOT EXISTS (SELECT 1 FROM "PrimaryOrderPriceComponent" c JOIN "PrimaryAdmissionTicket" t ON t."orderId" = c."orderId" WHERE c.id = NEW."orderComponentId" AND t.id = NEW."admissionTicketId" AND c."orderId" = NEW."orderId" AND c.currency = NEW.currency) THEN
      RAISE EXCEPTION 'Purchase allocation scope/currency mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'PrimaryRefund' THEN
    IF NOT EXISTS (SELECT 1 FROM "PrimaryOrder" o JOIN "PrimaryPaymentAttempt" p ON p."orderId" = o.id WHERE o.id = NEW."orderId" AND p.id = NEW."paymentAttemptId" AND o."organizerId" = NEW."organizerId" AND o."eventId" = NEW."eventId" AND o.currency = NEW.currency AND o.status = 'PAID') THEN
      RAISE EXCEPTION 'Refund requires exact paid order/payment scope';
    END IF;
  ELSIF TG_TABLE_NAME = 'PrimaryRefundItem' THEN
    IF NOT EXISTS (SELECT 1 FROM "PrimaryRefund" r JOIN "PrimaryAdmissionTicket" t ON t."orderId" = r."orderId" WHERE r.id = NEW."refundId" AND t.id = NEW."admissionTicketId" AND r.currency = NEW.currency) THEN
      RAISE EXCEPTION 'Refund item scope/currency mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM "PrimaryRefundItem" i JOIN "PrimaryRefund" r ON r.id = i."refundId" WHERE i."admissionTicketId" = NEW."admissionTicketId" AND r.status IN ('REQUESTED','PROVIDER_PENDING','SUCCEEDED','RECONCILIATION_REQUIRED')) THEN
      RAISE EXCEPTION 'Admission ticket already participates in an active or successful refund';
    END IF;
  ELSIF TG_TABLE_NAME = 'PrimaryRefundAllocation' THEN
    IF NOT EXISTS (SELECT 1 FROM "PrimaryRefundItem" i JOIN "PrimaryPurchaseAllocation" p ON p."admissionTicketId" = i."admissionTicketId" JOIN "PrimaryRefund" r ON r.id = i."refundId" WHERE i.id = NEW."refundItemId" AND i."refundId" = NEW."refundId" AND i."admissionTicketId" = NEW."admissionTicketId" AND p.id = NEW."purchaseAllocationId" AND p."orderId" = r."orderId" AND p.currency = NEW.currency AND NEW."amountMinor" <= p."amountMinor" AND p.refundable) THEN
      RAISE EXCEPTION 'Refund allocation exceeds or mismatches purchase allocation';
    END IF;
  ELSIF TG_TABLE_NAME = 'PrimaryAdmissionRevocation' THEN
    IF NOT EXISTS (SELECT 1 FROM "PrimaryAdmissionTicket" t JOIN "PrimaryAdmissionCredential" c ON c."admissionTicketId" = t.id WHERE t.id = NEW."admissionTicketId" AND c.id = NEW."credentialId" AND t."organizerId" = NEW."organizerId" AND t."eventId" = NEW."eventId") THEN
      RAISE EXCEPTION 'Revocation ticket/credential/event scope mismatch';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryPurchaseAllocation_scope" BEFORE INSERT ON "PrimaryPurchaseAllocation" FOR EACH ROW EXECUTE FUNCTION validate_primary_refund_scope();
CREATE TRIGGER "PrimaryRefund_scope" BEFORE INSERT ON "PrimaryRefund" FOR EACH ROW EXECUTE FUNCTION validate_primary_refund_scope();
CREATE TRIGGER "PrimaryRefundItem_scope" BEFORE INSERT ON "PrimaryRefundItem" FOR EACH ROW EXECUTE FUNCTION validate_primary_refund_scope();
CREATE TRIGGER "PrimaryRefundAllocation_scope" BEFORE INSERT ON "PrimaryRefundAllocation" FOR EACH ROW EXECUTE FUNCTION validate_primary_refund_scope();
CREATE TRIGGER "PrimaryAdmissionRevocation_scope" BEFORE INSERT ON "PrimaryAdmissionRevocation" FOR EACH ROW EXECUTE FUNCTION validate_primary_refund_scope();

-- Deterministic allocation materialization. It fails before writing when the
-- immutable order line does not have exactly one admission unit per quantity.
CREATE OR REPLACE FUNCTION materialize_primary_purchase_allocations(target_order_id TEXT) RETURNS INTEGER AS $$
DECLARE expected_units INTEGER; actual_units INTEGER; inserted_count INTEGER;
BEGIN
  SELECT l.quantity, count(t.id)::INTEGER INTO expected_units, actual_units
  FROM "PrimaryOrderLine" l LEFT JOIN "PrimaryAdmissionTicket" t ON t."orderLineId" = l.id
  WHERE l."orderId" = target_order_id GROUP BY l.quantity;
  IF expected_units IS NULL OR actual_units <> expected_units THEN RAISE EXCEPTION 'Incomplete immutable admission units for allocation materialization'; END IF;
  IF EXISTS (SELECT 1 FROM "PrimaryOrderPriceComponent" c JOIN "PrimaryOrder" o ON o.id=c."orderId" WHERE c."orderId"=target_order_id AND (c.currency<>o.currency OR c."amountMinor"<1)) THEN RAISE EXCEPTION 'Unsupported or inconsistent immutable component evidence'; END IF;

  WITH ranked AS (
    SELECT c.id component_id, c."orderId" order_id, c.currency, c."amountMinor", c.code, t.id ticket_id,
      row_number() OVER (PARTITION BY c.id ORDER BY t."orderLineId", t."unitNumber", c.id)::INTEGER rank,
      count(*) OVER (PARTITION BY c.id)::INTEGER units
    FROM "PrimaryOrderPriceComponent" c JOIN "PrimaryAdmissionTicket" t ON t."orderId"=c."orderId"
    WHERE c."orderId"=target_order_id
  ), materialized AS (
    SELECT encode(digest(component_id||':'||ticket_id||':v1','sha256'),'hex') id, order_id, component_id, ticket_id,
      ("amountMinor" / units) + CASE WHEN rank <= ("amountMinor" % units) THEN 1 ELSE 0 END amount_minor,
      currency, rank, code
    FROM ranked
  ), allocation_digests AS (
    SELECT component_id, encode(digest(string_agg(ticket_id||':'||amount_minor,',' ORDER BY ticket_id),'sha256'),'hex') allocation_digest
    FROM materialized GROUP BY component_id
  )
  INSERT INTO "PrimaryPurchaseAllocation" (id,"orderId","orderComponentId","admissionTicketId","amountMinor",currency,refundable,"liabilityOwner","remainderRank","algorithmVersion","policyVersionId","allocationSetDigest")
  SELECT id,order_id,component_id,ticket_id,amount_minor,currency,true,
    CASE WHEN code='TRUEFANTIX_ADMIN_FEE' THEN 'TRUEFANTIX'::"PrimaryPolicyLiabilityOwner" ELSE 'ORGANIZER'::"PrimaryPolicyLiabilityOwner" END,
    m.rank,1,'primary-refund-policy-v1',d.allocation_digest
  FROM materialized m JOIN allocation_digests d USING (component_id)
  ON CONFLICT ("orderComponentId","admissionTicketId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF EXISTS (SELECT 1 FROM "PrimaryOrderPriceComponent" c LEFT JOIN "PrimaryPurchaseAllocation" a ON a."orderComponentId"=c.id WHERE c."orderId"=target_order_id GROUP BY c.id,c."amountMinor" HAVING coalesce(sum(a."amountMinor"),0)<>c."amountMinor") THEN RAISE EXCEPTION 'Allocation reconciliation failed'; END IF;
  RETURN inserted_count;
END; $$ LANGUAGE plpgsql;

DO $$ DECLARE order_row RECORD; BEGIN
  FOR order_row IN SELECT id FROM "PrimaryOrder" WHERE status='PAID' ORDER BY id LOOP
    PERFORM materialize_primary_purchase_allocations(order_row.id);
  END LOOP;
END $$;

-- Append-only evidence and database-enforced aggregate transitions.
CREATE OR REPLACE FUNCTION reject_primary_refund_evidence_change() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundPolicyVersion_immutable" BEFORE UPDATE OR DELETE ON "PrimaryRefundPolicyVersion" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryPurchaseAllocation_immutable" BEFORE UPDATE OR DELETE ON "PrimaryPurchaseAllocation" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryRefundItem_immutable" BEFORE UPDATE OR DELETE ON "PrimaryRefundItem" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryRefundAllocation_immutable" BEFORE UPDATE OR DELETE ON "PrimaryRefundAllocation" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryRefundProviderEvent_immutable" BEFORE UPDATE OR DELETE ON "PrimaryRefundProviderEvent" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryCancellationBatch_immutable" BEFORE UPDATE OR DELETE ON "PrimaryCancellationBatch" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();
CREATE TRIGGER "PrimaryAdmissionRevocation_immutable" BEFORE UPDATE OR DELETE ON "PrimaryAdmissionRevocation" FOR EACH ROW EXECUTE FUNCTION reject_primary_refund_evidence_change();

CREATE OR REPLACE FUNCTION protect_primary_refund() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PrimaryRefund rows cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW."orderId",NEW."paymentAttemptId",NEW."requestedByUserId",NEW."policyVersionId",NEW."requestKey",NEW."commandDigest",NEW.reason,NEW."requestedAmountMinor",NEW.currency,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD."orderId",OLD."paymentAttemptId",OLD."requestedByUserId",OLD."policyVersionId",OLD."requestKey",OLD."commandDigest",OLD.reason,OLD."requestedAmountMinor",OLD.currency,OLD."createdAt") THEN RAISE EXCEPTION 'PrimaryRefund command evidence is immutable'; END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','CANCELLED_BEFORE_PROVIDER') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Terminal refund cannot transition'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='REQUESTED' AND NEW.status IN ('PROVIDER_PENDING','CANCELLED_BEFORE_PROVIDER')) OR (OLD.status IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED') AND NEW.status IN ('PROVIDER_PENDING','RECONCILIATION_REQUIRED','SUCCEEDED','FAILED'))) THEN RAISE EXCEPTION 'Invalid refund transition'; END IF;
  IF NEW.status='FAILED' AND EXISTS (SELECT 1 FROM "PrimaryRefundProviderAttempt" a WHERE a."refundId"=OLD.id AND a.status IN ('SEND_UNCERTAIN','PROVIDER_ATTACHED')) THEN RAISE EXCEPTION 'Refund cannot be abandoned while an attempt may succeed'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefund_protected" BEFORE UPDATE OR DELETE ON "PrimaryRefund" FOR EACH ROW EXECUTE FUNCTION protect_primary_refund();

CREATE OR REPLACE FUNCTION protect_primary_refund_attempt() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund attempts cannot be deleted'; END IF;
  IF ROW(NEW."refundId",NEW.ordinal,NEW."providerKey",NEW."expectedAmountMinor",NEW.currency,NEW."authorizationKey",NEW."authorizationDigest",NEW."authorizedByUserId",NEW."authorizationReason",NEW."createdAt") IS DISTINCT FROM ROW(OLD."refundId",OLD.ordinal,OLD."providerKey",OLD."expectedAmountMinor",OLD.currency,OLD."authorizationKey",OLD."authorizationDigest",OLD."authorizedByUserId",OLD."authorizationReason",OLD."createdAt") THEN RAISE EXCEPTION 'Refund attempt identity is immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='NOT_SENT' AND NEW.status IN ('SEND_UNCERTAIN','PROVIDER_ATTACHED','TERMINAL_FAILED')) OR (OLD.status='SEND_UNCERTAIN' AND NEW.status IN ('PROVIDER_ATTACHED','TERMINAL_FAILED','SUCCEEDED')) OR (OLD.status='PROVIDER_ATTACHED' AND NEW.status IN ('TERMINAL_FAILED','SUCCEEDED'))) THEN RAISE EXCEPTION 'Invalid refund attempt transition'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundProviderAttempt_protected" BEFORE UPDATE OR DELETE ON "PrimaryRefundProviderAttempt" FOR EACH ROW EXECUTE FUNCTION protect_primary_refund_attempt();

CREATE OR REPLACE FUNCTION validate_primary_next_refund_attempt() RETURNS trigger AS $$
DECLARE parent_status "PrimaryRefundStatus"; prior "PrimaryRefundProviderAttempt";
BEGIN
  SELECT status INTO parent_status FROM "PrimaryRefund" WHERE id=NEW."refundId" FOR UPDATE;
  IF parent_status <> 'PROVIDER_PENDING' THEN RAISE EXCEPTION 'Parent refund is not retryable'; END IF;
  IF NEW.ordinal=1 THEN RETURN NEW; END IF;
  SELECT * INTO prior FROM "PrimaryRefundProviderAttempt" WHERE "refundId"=NEW."refundId" AND ordinal=NEW.ordinal-1 FOR UPDATE;
  IF prior.id IS NULL OR prior.status<>'TERMINAL_FAILED' OR prior."terminalEvidenceHash" IS NULL THEN RAISE EXCEPTION 'Prior attempt is not authenticated terminal-impossible'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundProviderAttempt_authorization" BEFORE INSERT ON "PrimaryRefundProviderAttempt" FOR EACH ROW EXECUTE FUNCTION validate_primary_next_refund_attempt();

CREATE OR REPLACE FUNCTION protect_primary_cancellation() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancellation cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW.generation,NEW."policyVersionId",NEW."requestedByUserId",NEW."requestKey",NEW."commandDigest",NEW.reason,NEW."snapshotMaxTicketId",NEW."expectedTicketCount",NEW."expectedAmountMinor",NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD.generation,OLD."policyVersionId",OLD."requestedByUserId",OLD."requestKey",OLD."commandDigest",OLD.reason,OLD."snapshotMaxTicketId",OLD."expectedTicketCount",OLD."expectedAmountMinor",OLD."createdAt") THEN RAISE EXCEPTION 'Cancellation snapshot is immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='REQUESTED' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status IN ('REFUNDING','RECONCILIATION_REQUIRED')) OR (OLD.status='REFUNDING' AND NEW.status IN ('RESOLVED','RECONCILIATION_REQUIRED')) OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('REFUNDING','RESOLVED'))) THEN RAISE EXCEPTION 'Invalid cancellation transition'; END IF;
  IF NEW.status='RESOLVED' AND (NEW."processedTicketCount"<>NEW."expectedTicketCount" OR NEW."processedAmountMinor"<>NEW."expectedAmountMinor" OR EXISTS (SELECT 1 FROM "PrimaryRefundObligation" o WHERE o."cancellationId"=OLD.id AND o.status NOT IN ('SATISFIED','WAIVED_WITH_APPROVAL'))) THEN RAISE EXCEPTION 'Cancellation coverage is incomplete'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryEventCancellation_protected" BEFORE UPDATE OR DELETE ON "PrimaryEventCancellation" FOR EACH ROW EXECUTE FUNCTION protect_primary_cancellation();

CREATE OR REPLACE FUNCTION protect_primary_obligation() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Obligation cannot be deleted'; END IF;
  IF ROW(NEW."organizerId",NEW."eventId",NEW."orderId",NEW."cancellationId",NEW."refundId",NEW.cause,NEW."amountMinor",NEW.currency,NEW."idempotencyKey",NEW.reason,NEW."createdAt") IS DISTINCT FROM ROW(OLD."organizerId",OLD."eventId",OLD."orderId",OLD."cancellationId",OLD."refundId",OLD.cause,OLD."amountMinor",OLD.currency,OLD."idempotencyKey",OLD.reason,OLD."createdAt") THEN RAISE EXCEPTION 'Obligation evidence is immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='OPEN' AND NEW.status IN ('REFUND_LINKED','WAIVED_WITH_APPROVAL','RECONCILIATION_REQUIRED')) OR (OLD.status='REFUND_LINKED' AND NEW.status IN ('SATISFIED','RECONCILIATION_REQUIRED')) OR (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status IN ('REFUND_LINKED','SATISFIED','WAIVED_WITH_APPROVAL'))) THEN RAISE EXCEPTION 'Invalid obligation transition'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PrimaryRefundObligation_protected" BEFORE UPDATE OR DELETE ON "PrimaryRefundObligation" FOR EACH ROW EXECUTE FUNCTION protect_primary_obligation();
