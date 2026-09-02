ALTER TABLE "OutreachContact"
  ADD COLUMN "league" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "country" TEXT;

CREATE INDEX "OutreachContact_league_city_idx" ON "OutreachContact"("league", "city");
CREATE INDEX "OutreachContact_subjectName_idx" ON "OutreachContact"("subjectName");
