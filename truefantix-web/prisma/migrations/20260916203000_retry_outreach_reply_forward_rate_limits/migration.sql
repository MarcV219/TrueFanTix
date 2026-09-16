ALTER TABLE "OutreachReplyForwardIntent"
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OutreachReplyForwardIntent"
  DROP CONSTRAINT "OutreachReplyForwardIntent_bounds_check",
  DROP CONSTRAINT "OutreachReplyForwardIntent_state_check";

ALTER TABLE "OutreachReplyForwardIntent"
  ADD CONSTRAINT "OutreachReplyForwardIntent_bounds_check" CHECK (
    char_length("providerEmailId") BETWEEN 1 AND 256
    AND char_length("fromEmailSnapshot") BETWEEN 3 AND 320
    AND char_length("toEmailSnapshot") BETWEEN 3 AND 320
    AND char_length("subjectSnapshot") BETWEEN 1 AND 1000
    AND char_length("textBodySnapshot") BETWEEN 1 AND 110000
    AND "attachmentCount" BETWEEN 0 AND 100
    AND char_length("idempotencyKey") BETWEEN 1 AND 256
    AND "retryCount" BETWEEN 0 AND 2
    AND ("claimToken" IS NULL OR char_length("claimToken") BETWEEN 1 AND 128)
    AND ("providerMessageId" IS NULL OR char_length("providerMessageId") BETWEEN 1 AND 512)
    AND ("failureCode" IS NULL OR "failureCode" IN (
      'FORWARD_CONFIGURATION_DRIFT', 'FORWARD_LOCAL_ENVELOPE_INVALID',
      'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH', 'RESEND_FORWARD_REJECTED',
      'RESEND_FORWARD_RATE_LIMITED', 'RESEND_FORWARD_RATE_LIMIT_EXHAUSTED',
      'RESEND_FORWARD_TIMEOUT', 'RESEND_FORWARD_TRANSPORT_UNCERTAIN',
      'RESEND_FORWARD_CONCURRENT_IDEMPOTENCY', 'RESEND_FORWARD_HTTP_UNCERTAIN',
      'RESEND_FORWARD_ACCEPTANCE_INVALID', 'FORWARD_ACCEPTANCE_PERSISTENCE_FAILED',
      'RESEND_FORWARD_OUTCOME_UNCERTAIN'
    ))
  ),
  ADD CONSTRAINT "OutreachReplyForwardIntent_state_check" CHECK (
    ("status" = 'PENDING' AND "attemptCount" = 0
      AND "claimToken" IS NULL AND "claimExpiresAt" IS NULL
      AND "providerDispatchAt" IS NULL AND "providerMessageId" IS NULL
      AND "completedAt" IS NULL
      AND (("retryCount" = 0 AND "failureCode" IS NULL)
        OR ("retryCount" BETWEEN 1 AND 2 AND "failureCode" = 'RESEND_FORWARD_RATE_LIMITED')))
    OR ("status" = 'PROCESSING' AND "attemptCount" IN (0, 1)
      AND "claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL
      AND (("attemptCount" = 0 AND "providerDispatchAt" IS NULL)
        OR ("attemptCount" = 1 AND "providerDispatchAt" IS NOT NULL))
      AND "providerMessageId" IS NULL AND "completedAt" IS NULL
      AND (("retryCount" = 0 AND "failureCode" IS NULL)
        OR ("retryCount" BETWEEN 1 AND 2 AND "failureCode" = 'RESEND_FORWARD_RATE_LIMITED')))
    OR ("status" = 'DELIVERED' AND "attemptCount" = 1
      AND "claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL
      AND "providerDispatchAt" IS NOT NULL AND "providerMessageId" IS NOT NULL
      AND "failureCode" IS NULL AND "completedAt" IS NOT NULL)
    OR ("status" = 'FAILED' AND "attemptCount" = 1
      AND "claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL
      AND "providerDispatchAt" IS NOT NULL AND "providerMessageId" IS NULL
      AND "failureCode" IN ('RESEND_FORWARD_REJECTED', 'RESEND_FORWARD_RATE_LIMIT_EXHAUSTED')
      AND "completedAt" IS NOT NULL)
    OR ("status" = 'RECONCILIATION_REQUIRED' AND "attemptCount" = 1
      AND "claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL
      AND "providerDispatchAt" IS NOT NULL AND "providerMessageId" IS NULL
      AND "failureCode" IN (
        'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH', 'RESEND_FORWARD_TIMEOUT',
        'RESEND_FORWARD_TRANSPORT_UNCERTAIN', 'RESEND_FORWARD_CONCURRENT_IDEMPOTENCY',
        'RESEND_FORWARD_HTTP_UNCERTAIN', 'RESEND_FORWARD_ACCEPTANCE_INVALID',
        'FORWARD_ACCEPTANCE_PERSISTENCE_FAILED', 'RESEND_FORWARD_OUTCOME_UNCERTAIN'
      ) AND "completedAt" IS NOT NULL)
    OR ("status" = 'QUARANTINED' AND "attemptCount" = 0
      AND "claimToken" IS NULL AND "claimExpiresAt" IS NULL
      AND "providerDispatchAt" IS NULL AND "providerMessageId" IS NULL
      AND "failureCode" IN ('FORWARD_CONFIGURATION_DRIFT', 'FORWARD_LOCAL_ENVELOPE_INVALID')
      AND "completedAt" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION "guard_outreach_reply_forward_intent"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  database_clock TIMESTAMP(3) := (statement_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);
  rate_limit_retry BOOLEAN := TG_OP = 'UPDATE'
    AND OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1
    AND NEW."status" = 'PENDING';
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."createdAt" := database_clock;
    NEW."updatedAt" := database_clock;
    NEW."availableAt" := database_clock;
    IF NEW."status" <> 'PENDING' OR NEW."attemptCount" <> 0 OR NEW."retryCount" <> 0
      OR NEW."claimToken" IS NOT NULL OR NEW."claimExpiresAt" IS NOT NULL
      OR NEW."providerDispatchAt" IS NOT NULL OR NEW."providerMessageId" IS NOT NULL
      OR NEW."failureCode" IS NOT NULL OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'outreach reply forward intent must originate pending';
    END IF;
  ELSE
    NEW."updatedAt" := database_clock;
  END IF;

  IF NEW."idempotencyKey" IS DISTINCT FROM outreach_reply_forward_idempotency_key(
    NEW."providerEmailId", NEW."fromEmailSnapshot", NEW."toEmailSnapshot",
    NEW."subjectSnapshot", NEW."textBodySnapshot", NEW."attachmentCount"
  ) THEN RAISE EXCEPTION 'outreach reply forward idempotency identity is invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "OutreachReply" WHERE "id" = NEW."replyId"
    AND "providerEmailId" = NEW."providerEmailId") THEN
    RAISE EXCEPTION 'outreach reply forward source identity is invalid';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."replyId" IS DISTINCT FROM OLD."replyId"
    OR NEW."providerEmailId" IS DISTINCT FROM OLD."providerEmailId"
    OR NEW."fromEmailSnapshot" IS DISTINCT FROM OLD."fromEmailSnapshot"
    OR NEW."toEmailSnapshot" IS DISTINCT FROM OLD."toEmailSnapshot"
    OR NEW."subjectSnapshot" IS DISTINCT FROM OLD."subjectSnapshot"
    OR NEW."textBodySnapshot" IS DISTINCT FROM OLD."textBodySnapshot"
    OR NEW."attachmentCount" IS DISTINCT FROM OLD."attachmentCount"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR (NEW."availableAt" IS DISTINCT FROM OLD."availableAt" AND NOT rate_limit_retry)
  ) THEN RAISE EXCEPTION 'outreach reply forward envelope is immutable'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" IN ('DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED', 'QUARANTINED') THEN
      RAISE EXCEPTION 'terminal outreach reply forward intent is immutable';
    END IF;
    IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('PROCESSING', 'QUARANTINED') THEN
      RAISE EXCEPTION 'invalid pending outreach reply forward transition';
    END IF;
    IF OLD."status" = 'PENDING' AND NEW."status" = 'PROCESSING' AND (
      NEW."attemptCount" <> 0 OR NEW."retryCount" <> OLD."retryCount"
      OR NEW."failureCode" IS DISTINCT FROM OLD."failureCode"
      OR NEW."claimExpiresAt" IS DISTINCT FROM (database_clock + INTERVAL '15 minutes')::TIMESTAMP(3)
    ) THEN RAISE EXCEPTION 'outreach reply forward claim does not use the database lease clock'; END IF;
    IF OLD."status" = 'PENDING' AND NEW."status" = 'QUARANTINED' AND (
      NEW."retryCount" <> OLD."retryCount" OR NEW."completedAt" IS DISTINCT FROM database_clock
      OR NEW."failureCode" NOT IN ('FORWARD_CONFIGURATION_DRIFT', 'FORWARD_LOCAL_ENVELOPE_INVALID')
    ) THEN RAISE EXCEPTION 'invalid outreach reply forward quarantine'; END IF;

    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 0 THEN
      IF NEW."status" = 'PENDING' THEN
        IF OLD."claimExpiresAt" > database_clock THEN
          RAISE EXCEPTION 'live pre-dispatch outreach reply forward claim cannot reset';
        END IF;
      ELSIF NOT (NEW."status" = 'PROCESSING' AND NEW."attemptCount" = 1
        AND NEW."retryCount" = OLD."retryCount"
        AND NEW."failureCode" IS NOT DISTINCT FROM OLD."failureCode"
        AND NEW."claimToken" = OLD."claimToken" AND NEW."claimExpiresAt" = OLD."claimExpiresAt"
        AND OLD."claimExpiresAt" > database_clock AND NEW."providerDispatchAt" = database_clock) THEN
        RAISE EXCEPTION 'invalid pre-dispatch outreach reply forward transition';
      END IF;
    END IF;

    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1 THEN
      IF NEW."status" = 'PENDING' THEN
        IF OLD."claimExpiresAt" <= database_clock OR OLD."retryCount" >= 2
          OR NEW."retryCount" <> OLD."retryCount" + 1
          OR NEW."attemptCount" <> 0 OR NEW."claimToken" IS NOT NULL
          OR NEW."claimExpiresAt" IS NOT NULL OR NEW."providerDispatchAt" IS NOT NULL
          OR NEW."providerMessageId" IS NOT NULL
          OR NEW."failureCode" <> 'RESEND_FORWARD_RATE_LIMITED' OR NEW."completedAt" IS NOT NULL
          OR NEW."availableAt" <= database_clock
          OR NEW."availableAt" > (database_clock + INTERVAL '15 minutes')::TIMESTAMP(3) THEN
          RAISE EXCEPTION 'invalid rate-limited outreach reply forward retry';
        END IF;
      ELSIF NEW."status" NOT IN ('DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED') THEN
        RAISE EXCEPTION 'invalid dispatched outreach reply forward transition';
      END IF;
    END IF;

    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1
      AND NEW."status" IN ('DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED')
      AND NOT (NEW."status" = 'RECONCILIATION_REQUIRED'
        AND NEW."failureCode" = 'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH')
      AND OLD."claimExpiresAt" <= database_clock THEN
      RAISE EXCEPTION 'expired outreach reply forward claim cannot record a provider result';
    END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1
      AND NEW."status" = 'RECONCILIATION_REQUIRED'
      AND NEW."failureCode" = 'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH'
      AND OLD."claimExpiresAt" > database_clock THEN
      RAISE EXCEPTION 'live outreach reply forward claim cannot use expired-lease recovery';
    END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1 AND NOT rate_limit_retry AND (
      (NEW."status" = 'FAILED' AND NEW."failureCode" NOT IN
        ('RESEND_FORWARD_REJECTED', 'RESEND_FORWARD_RATE_LIMIT_EXHAUSTED'))
      OR (NEW."status" = 'RECONCILIATION_REQUIRED' AND NEW."failureCode" NOT IN (
        'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH', 'RESEND_FORWARD_TIMEOUT',
        'RESEND_FORWARD_TRANSPORT_UNCERTAIN', 'RESEND_FORWARD_CONCURRENT_IDEMPOTENCY',
        'RESEND_FORWARD_HTTP_UNCERTAIN', 'RESEND_FORWARD_ACCEPTANCE_INVALID',
        'FORWARD_ACCEPTANCE_PERSISTENCE_FAILED', 'RESEND_FORWARD_OUTCOME_UNCERTAIN'))
    ) THEN RAISE EXCEPTION 'invalid outreach reply forward outcome classification'; END IF;
    IF OLD."status" = 'PROCESSING' AND NOT rate_limit_retry AND NEW."status" <> 'PENDING' AND (
      NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
      OR NEW."claimExpiresAt" IS DISTINCT FROM OLD."claimExpiresAt"
    ) THEN RAISE EXCEPTION 'outreach reply forward claim evidence is immutable'; END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1 AND NOT rate_limit_retry AND (
      NEW."attemptCount" <> 1 OR NEW."retryCount" <> OLD."retryCount"
      OR NEW."providerDispatchAt" IS DISTINCT FROM OLD."providerDispatchAt"
      OR NEW."completedAt" IS DISTINCT FROM database_clock
    ) THEN RAISE EXCEPTION 'outreach reply forward dispatch evidence is immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
