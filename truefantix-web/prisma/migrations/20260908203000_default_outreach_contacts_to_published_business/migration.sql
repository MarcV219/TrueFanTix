-- Existing explicit classifications remain unchanged. Only the former default state
-- is promoted to the published-business classification requested for outreach.
UPDATE "OutreachContact"
SET "consentBasis" = 'CONSPICUOUSLY_PUBLISHED'
WHERE "consentBasis" = 'UNASSESSED';

ALTER TABLE "OutreachContact"
ALTER COLUMN "consentBasis" SET DEFAULT 'CONSPICUOUSLY_PUBLISHED';
