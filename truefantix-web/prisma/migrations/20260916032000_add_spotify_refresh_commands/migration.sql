-- Give each exact Spotify credential version one durable, non-reclaimable
-- refresh owner. Provider secrets remain only on ConnectedAccount; commands
-- retain bounded ownership and outcome evidence.
BEGIN;

CREATE TYPE "SpotifyRefreshCommandStatus" AS ENUM (
  'PENDING',
  'ATTEMPTING',
  'SUCCEEDED',
  'RECONNECT_REQUIRED'
);

CREATE TYPE "SpotifyProviderContactStatus" AS ENUM (
  'NOT_CONTACTED',
  'CONTACTED',
  'CONTACT_UNCERTAIN'
);

ALTER TABLE "ConnectedAccount" ADD COLUMN "currentRefreshCommandId" TEXT;

CREATE TABLE "SpotifyRefreshCommand" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "sourceVersionDigest" TEXT NOT NULL,
  "sourceExpiresAt" TIMESTAMP(3),
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "attemptId" TEXT NOT NULL,
  "terminalAttemptId" TEXT,
  "status" "SpotifyRefreshCommandStatus" NOT NULL DEFAULT 'PENDING',
  "providerContactStatus" "SpotifyProviderContactStatus" NOT NULL DEFAULT 'NOT_CONTACTED',
  "providerHttpStatus" INTEGER,
  "resultVersionDigest" TEXT,
  "resultExpiresAt" TIMESTAMP(3),
  "refreshTokenRotated" BOOLEAN,
  "failureCode" TEXT,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SpotifyRefreshCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpotifyRefreshCommand_provider" CHECK ("provider" = 'spotify'),
  CONSTRAINT "SpotifyRefreshCommand_source_digest" CHECK ("sourceVersionDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpotifyRefreshCommand_result_digest" CHECK ("resultVersionDigest" IS NULL OR "resultVersionDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SpotifyRefreshCommand_attempt" CHECK (LENGTH(BTRIM("attemptId")) BETWEEN 16 AND 128),
  CONSTRAINT "SpotifyRefreshCommand_terminal_attempt" CHECK (
    "terminalAttemptId" IS NULL OR LENGTH(BTRIM("terminalAttemptId")) BETWEEN 16 AND 128
  ),
  CONSTRAINT "SpotifyRefreshCommand_http_status" CHECK ("providerHttpStatus" IS NULL OR "providerHttpStatus" BETWEEN 100 AND 599),
  CONSTRAINT "SpotifyRefreshCommand_failure_code" CHECK (
    "failureCode" IS NULL OR "failureCode" IN (
      'REFRESH_INPUT_UNAVAILABLE',
      'PROVIDER_REJECTED',
      'PROVIDER_INVALID_RESPONSE',
      'PROVIDER_OUTCOME_UNCERTAIN',
      'LOCAL_FINALIZATION_FAILED',
      'SOURCE_VERSION_CHANGED'
    )
  )
);

CREATE UNIQUE INDEX "ConnectedAccount_currentRefreshCommandId_key"
  ON "ConnectedAccount"("currentRefreshCommandId");
CREATE UNIQUE INDEX "SpotifyRefreshCommand_attemptId_key"
  ON "SpotifyRefreshCommand"("attemptId");
CREATE UNIQUE INDEX "SpotifyRefreshCommand_connectionId_sourceVersionDigest_key"
  ON "SpotifyRefreshCommand"("connectionId", "sourceVersionDigest");
CREATE INDEX "SpotifyRefreshCommand_userId_createdAt_idx"
  ON "SpotifyRefreshCommand"("userId", "createdAt");
CREATE INDEX "SpotifyRefreshCommand_status_authorizedAt_idx"
  ON "SpotifyRefreshCommand"("status", "authorizedAt");

ALTER TABLE "SpotifyRefreshCommand" ADD CONSTRAINT "SpotifyRefreshCommand_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_currentRefreshCommandId_fkey"
  FOREIGN KEY ("currentRefreshCommandId") REFERENCES "SpotifyRefreshCommand"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION spotify_connected_account_version_digest(account_row "ConnectedAccount")
RETURNS TEXT AS $$
BEGIN
  RETURN ENCODE(DIGEST(CONVERT_TO(
    account_row.id || E'\n'
    || account_row."providerAccountId" || E'\n'
    || account_row."accessTokenEncrypted" || E'\n'
    || COALESCE(account_row."refreshTokenEncrypted", '') || E'\n'
    || COALESCE((EXTRACT(EPOCH FROM account_row."expiresAt") * 1000)::BIGINT::TEXT, '') || E'\n'
    || (EXTRACT(EPOCH FROM account_row."updatedAt") * 1000)::BIGINT::TEXT,
    'UTF8'
  ), 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql STABLE STRICT;

CREATE FUNCTION protect_spotify_refresh_command()
RETURNS TRIGGER AS $$
DECLARE
  user_exists BOOLEAN;
  account_row "ConnectedAccount"%ROWTYPE;
  current_digest TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Spotify refresh command evidence cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT TRUE INTO user_exists FROM "User" WHERE id = NEW."userId" FOR UPDATE;
    SELECT * INTO account_row FROM "ConnectedAccount" WHERE id = NEW."connectionId" FOR UPDATE;
    IF COALESCE(user_exists, FALSE) IS NOT TRUE
      OR account_row.id IS NULL
      OR account_row."userId" IS DISTINCT FROM NEW."userId"
      OR account_row.provider IS DISTINCT FROM NEW.provider
      OR account_row."providerAccountId" IS DISTINCT FROM NEW."providerAccountId"
      OR account_row."expiresAt" IS DISTINCT FROM NEW."sourceExpiresAt"
      OR account_row."updatedAt" IS DISTINCT FROM NEW."sourceUpdatedAt"
      OR spotify_connected_account_version_digest(account_row) IS DISTINCT FROM NEW."sourceVersionDigest" THEN
      RAISE EXCEPTION 'Spotify refresh source snapshot mismatch';
    END IF;
    IF NEW.status <> 'PENDING'
      OR NEW."providerContactStatus" <> 'NOT_CONTACTED'
      OR NEW."providerHttpStatus" IS NOT NULL
      OR NEW."resultVersionDigest" IS NOT NULL
      OR NEW."resultExpiresAt" IS NOT NULL
      OR NEW."refreshTokenRotated" IS NOT NULL
      OR NEW."failureCode" IS NOT NULL
      OR NEW."terminalAttemptId" IS NOT NULL
      OR NEW."claimedAt" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Spotify refresh command must begin as pristine PENDING evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF TO_JSONB(NEW) - ARRAY[
      'status', 'providerContactStatus', 'providerHttpStatus', 'resultVersionDigest',
      'resultExpiresAt', 'refreshTokenRotated', 'failureCode', 'claimedAt',
      'terminalAttemptId', 'completedAt', 'updatedAt'
    ] IS DISTINCT FROM TO_JSONB(OLD) - ARRAY[
      'status', 'providerContactStatus', 'providerHttpStatus', 'resultVersionDigest',
      'resultExpiresAt', 'refreshTokenRotated', 'failureCode', 'claimedAt',
      'terminalAttemptId', 'completedAt', 'updatedAt'
    ] THEN
    RAISE EXCEPTION 'Spotify refresh ownership evidence is immutable';
  END IF;

  IF OLD."providerHttpStatus" IS NOT NULL AND NEW."providerHttpStatus" IS DISTINCT FROM OLD."providerHttpStatus"
    OR OLD."resultVersionDigest" IS NOT NULL AND NEW."resultVersionDigest" IS DISTINCT FROM OLD."resultVersionDigest"
    OR OLD."resultExpiresAt" IS NOT NULL AND NEW."resultExpiresAt" IS DISTINCT FROM OLD."resultExpiresAt"
    OR OLD."refreshTokenRotated" IS NOT NULL AND NEW."refreshTokenRotated" IS DISTINCT FROM OLD."refreshTokenRotated"
    OR OLD."failureCode" IS NOT NULL AND NEW."failureCode" IS DISTINCT FROM OLD."failureCode"
    OR OLD."terminalAttemptId" IS NOT NULL AND NEW."terminalAttemptId" IS DISTINCT FROM OLD."terminalAttemptId"
    OR OLD."claimedAt" IS NOT NULL AND NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt"
    OR OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt" THEN
    RAISE EXCEPTION 'Spotify refresh outcome evidence cannot be overwritten';
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status = 'ATTEMPTING' THEN
    SELECT * INTO account_row FROM "ConnectedAccount" WHERE id = NEW."connectionId" FOR UPDATE;
    current_digest := CASE WHEN account_row.id IS NULL THEN NULL ELSE spotify_connected_account_version_digest(account_row) END;
    IF account_row."userId" IS DISTINCT FROM NEW."userId"
      OR account_row.provider IS DISTINCT FROM NEW.provider
      OR account_row."providerAccountId" IS DISTINCT FROM NEW."providerAccountId"
      OR account_row."expiresAt" IS DISTINCT FROM NEW."sourceExpiresAt"
      OR account_row."updatedAt" IS DISTINCT FROM NEW."sourceUpdatedAt"
      OR current_digest IS DISTINCT FROM NEW."sourceVersionDigest"
      OR NEW."providerContactStatus" <> 'NOT_CONTACTED'
      OR NEW."claimedAt" IS NULL
      OR NEW."providerHttpStatus" IS NOT NULL
      OR NEW."resultVersionDigest" IS NOT NULL
      OR NEW."resultExpiresAt" IS NOT NULL
      OR NEW."refreshTokenRotated" IS NOT NULL
      OR NEW."failureCode" IS NOT NULL
      OR NEW."terminalAttemptId" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid Spotify refresh claim';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO account_row FROM "ConnectedAccount" WHERE id = NEW."connectionId";
    IF NEW."providerContactStatus" <> 'CONTACTED'
      OR NEW."providerHttpStatus" IS NULL OR NEW."providerHttpStatus" NOT BETWEEN 200 AND 299
      OR NEW."resultVersionDigest" IS NULL
      OR NEW."resultExpiresAt" IS NULL
      OR NEW."refreshTokenRotated" IS NULL
      OR NEW."terminalAttemptId" IS DISTINCT FROM NEW."attemptId"
      OR NEW."failureCode" IS NOT NULL
      OR NEW."completedAt" IS NULL
      OR account_row."currentRefreshCommandId" IS DISTINCT FROM NEW.id
      OR account_row."expiresAt" IS DISTINCT FROM NEW."resultExpiresAt"
      OR spotify_connected_account_version_digest(account_row) IS DISTINCT FROM NEW."resultVersionDigest" THEN
      RAISE EXCEPTION 'Invalid Spotify refresh success evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ATTEMPTING' AND NEW.status = 'RECONNECT_REQUIRED' THEN
    IF NEW."failureCode" IS NULL OR NEW."completedAt" IS NULL
      OR NEW."terminalAttemptId" IS DISTINCT FROM NEW."attemptId"
      OR NEW."resultVersionDigest" IS NOT NULL
      OR (NEW."providerContactStatus" = 'NOT_CONTACTED' AND (
        NEW."providerHttpStatus" IS NOT NULL OR NEW."resultExpiresAt" IS NOT NULL OR NEW."refreshTokenRotated" IS NOT NULL
      ))
      OR (NEW."providerContactStatus" = 'CONTACT_UNCERTAIN' AND NEW."providerHttpStatus" IS NOT NULL)
      OR (NEW."providerContactStatus" = 'CONTACTED' AND NEW."providerHttpStatus" IS NULL)
      OR (NEW."providerContactStatus" = 'NOT_CONTACTED'
        AND NEW."failureCode" NOT IN ('REFRESH_INPUT_UNAVAILABLE', 'SOURCE_VERSION_CHANGED'))
      OR (NEW."providerContactStatus" = 'CONTACT_UNCERTAIN'
        AND NEW."failureCode" <> 'PROVIDER_OUTCOME_UNCERTAIN')
      OR (NEW."providerContactStatus" = 'CONTACTED' AND NEW."failureCode" = 'PROVIDER_REJECTED' AND (
        NEW."providerHttpStatus" BETWEEN 200 AND 299
        OR NEW."resultExpiresAt" IS NOT NULL OR NEW."refreshTokenRotated" IS NOT NULL
      ))
      OR (NEW."providerContactStatus" = 'CONTACTED' AND NEW."failureCode" = 'PROVIDER_INVALID_RESPONSE' AND (
        NEW."providerHttpStatus" NOT BETWEEN 200 AND 299
        OR NEW."resultExpiresAt" IS NOT NULL OR NEW."refreshTokenRotated" IS NOT NULL
      ))
      OR (NEW."providerContactStatus" = 'CONTACTED' AND NEW."failureCode" = 'LOCAL_FINALIZATION_FAILED' AND (
        NEW."providerHttpStatus" NOT BETWEEN 200 AND 299
        OR NEW."resultExpiresAt" IS NULL OR NEW."refreshTokenRotated" IS NULL
      ))
      OR (NEW."providerContactStatus" = 'CONTACTED'
        AND NEW."failureCode" NOT IN ('PROVIDER_REJECTED', 'PROVIDER_INVALID_RESPONSE', 'LOCAL_FINALIZATION_FAILED')) THEN
      RAISE EXCEPTION 'Invalid Spotify refresh reconnect evidence';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid Spotify refresh command state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SpotifyRefreshCommand_history"
BEFORE INSERT OR UPDATE OR DELETE ON "SpotifyRefreshCommand"
FOR EACH ROW EXECUTE FUNCTION protect_spotify_refresh_command();

CREATE FUNCTION reject_spotify_refresh_command_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Spotify refresh command evidence cannot be truncated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SpotifyRefreshCommand_no_truncate"
BEFORE TRUNCATE ON "SpotifyRefreshCommand"
FOR EACH STATEMENT EXECUTE FUNCTION reject_spotify_refresh_command_truncate();

CREATE FUNCTION protect_spotify_refresh_projection()
RETURNS TRIGGER AS $$
DECLARE
  command_row "SpotifyRefreshCommand"%ROWTYPE;
  old_digest TEXT;
  new_digest TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."currentRefreshCommandId" IS NOT NULL THEN
      RAISE EXCEPTION 'A new Spotify connection cannot inherit refresh ownership';
    END IF;
    IF NEW.provider = 'spotify'
      AND EXISTS (SELECT 1 FROM "SpotifyRefreshCommand" WHERE "connectionId" = NEW.id) THEN
      RAISE EXCEPTION 'A Spotify reconnect cannot reuse a historical connection identity';
    END IF;
    RETURN NEW;
  END IF;

  old_digest := spotify_connected_account_version_digest(OLD);
  new_digest := spotify_connected_account_version_digest(NEW);

  IF OLD."currentRefreshCommandId" IS NOT DISTINCT FROM NEW."currentRefreshCommandId" THEN
    IF OLD."currentRefreshCommandId" IS NOT NULL AND old_digest IS DISTINCT FROM new_digest THEN
      RAISE EXCEPTION 'The current Spotify refresh projection is immutable without a successor command';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."currentRefreshCommandId" IS NULL THEN
    RAISE EXCEPTION 'Spotify refresh ownership can be cleared only by deleting the connection';
  END IF;
  SELECT * INTO command_row FROM "SpotifyRefreshCommand" WHERE id = NEW."currentRefreshCommandId";
  IF command_row.id IS NULL
    OR command_row.status <> 'ATTEMPTING'
    OR command_row."connectionId" IS DISTINCT FROM OLD.id
    OR command_row."userId" IS DISTINCT FROM OLD."userId"
    OR command_row.provider IS DISTINCT FROM OLD.provider
    OR command_row."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
    OR command_row."sourceVersionDigest" IS DISTINCT FROM old_digest
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
    OR new_digest IS NOT DISTINCT FROM old_digest THEN
    RAISE EXCEPTION 'Spotify refresh projection is not owned by the exact attempting command';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ConnectedAccount_refresh_projection"
BEFORE INSERT OR UPDATE ON "ConnectedAccount"
FOR EACH ROW EXECUTE FUNCTION protect_spotify_refresh_projection();

CREATE FUNCTION validate_spotify_refresh_success_projection()
RETURNS TRIGGER AS $$
DECLARE
  account_row "ConnectedAccount"%ROWTYPE;
  command_row "SpotifyRefreshCommand"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'SpotifyRefreshCommand' THEN
    IF NEW.status <> 'SUCCEEDED' THEN
      RETURN NULL;
    END IF;
    SELECT * INTO account_row FROM "ConnectedAccount" WHERE id = NEW."connectionId";
    IF account_row.id IS NULL
      OR account_row."currentRefreshCommandId" IS DISTINCT FROM NEW.id
      OR spotify_connected_account_version_digest(account_row) IS DISTINCT FROM NEW."resultVersionDigest" THEN
      RAISE EXCEPTION 'Spotify refresh success requires its exact current projection';
    END IF;
    RETURN NULL;
  END IF;

  IF NEW."currentRefreshCommandId" IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO command_row FROM "SpotifyRefreshCommand" WHERE id = NEW."currentRefreshCommandId";
  IF command_row.id IS NULL
    OR command_row.status <> 'SUCCEEDED'
    OR command_row."connectionId" IS DISTINCT FROM NEW.id
    OR command_row."userId" IS DISTINCT FROM NEW."userId"
    OR command_row.provider IS DISTINCT FROM NEW.provider
    OR command_row."providerAccountId" IS DISTINCT FROM NEW."providerAccountId"
    OR command_row."resultVersionDigest" IS DISTINCT FROM spotify_connected_account_version_digest(NEW) THEN
    RAISE EXCEPTION 'Spotify current projection requires exact succeeded ownership';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "SpotifyRefreshCommand_success_projection"
AFTER INSERT OR UPDATE ON "SpotifyRefreshCommand"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_spotify_refresh_success_projection();

CREATE CONSTRAINT TRIGGER "ConnectedAccount_refresh_success"
AFTER INSERT OR UPDATE ON "ConnectedAccount"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_spotify_refresh_success_projection();

COMMIT;
