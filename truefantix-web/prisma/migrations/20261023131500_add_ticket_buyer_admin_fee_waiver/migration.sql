ALTER TABLE "Ticket"
ADD COLUMN "buyerAdminFeeWaived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "buyerAdminFeeWaiverReason" TEXT,
ADD COLUMN "buyerAdminFeeWaivedAt" TIMESTAMP(3),
ADD COLUMN "buyerAdminFeeWaivedByUserId" TEXT;
