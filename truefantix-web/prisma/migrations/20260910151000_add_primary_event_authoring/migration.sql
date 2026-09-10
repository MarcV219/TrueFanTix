-- Draft event authoring only. Events remain non-public and non-purchasable.

CREATE TYPE "PrimaryEventStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "PrimaryEvent"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT 'Untitled draft',
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "venueName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "venueAddressLine1" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "venueAddressLine2" TEXT,
  ADD COLUMN "venueCity" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "venueRegion" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "venuePostalCode" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "venueCountry" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "startsAtLocal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "endsAtLocal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "accessibilityInfo" TEXT,
  ADD COLUMN "contactEmail" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "draftPolicyText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" "PrimaryEventStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT;

ALTER TABLE "PrimaryEvent"
  ALTER COLUMN "title" DROP DEFAULT,
  ALTER COLUMN "description" DROP DEFAULT,
  ALTER COLUMN "category" DROP DEFAULT,
  ALTER COLUMN "venueName" DROP DEFAULT,
  ALTER COLUMN "venueAddressLine1" DROP DEFAULT,
  ALTER COLUMN "venueCity" DROP DEFAULT,
  ALTER COLUMN "venueRegion" DROP DEFAULT,
  ALTER COLUMN "venuePostalCode" DROP DEFAULT,
  ALTER COLUMN "venueCountry" DROP DEFAULT,
  ALTER COLUMN "startsAtLocal" DROP DEFAULT,
  ALTER COLUMN "endsAtLocal" DROP DEFAULT,
  ALTER COLUMN "timezone" DROP DEFAULT,
  ALTER COLUMN "contactEmail" DROP DEFAULT,
  ALTER COLUMN "draftPolicyText" DROP DEFAULT;

CREATE INDEX "PrimaryEvent_organizerId_status_createdAt_idx" ON "PrimaryEvent"("organizerId", "status", "createdAt");
CREATE INDEX "PrimaryEvent_startsAtLocal_idx" ON "PrimaryEvent"("startsAtLocal");

ALTER TABLE "PrimaryEvent" ADD CONSTRAINT "PrimaryEvent_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
