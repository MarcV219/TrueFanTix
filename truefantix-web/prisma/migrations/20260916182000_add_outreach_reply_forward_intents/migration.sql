CREATE TABLE "OutreachReplyForwardIntent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "replyId" TEXT NOT NULL,
  "providerEmailId" TEXT NOT NULL,
  "fromEmailSnapshot" TEXT NOT NULL,
  "toEmailSnapshot" TEXT NOT NULL,
  "subjectSnapshot" TEXT NOT NULL,
  "textBodySnapshot" TEXT NOT NULL,
  "attachmentCount" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "claimToken" TEXT,
  "claimExpiresAt" TIMESTAMP(3),
  "providerDispatchAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "failureCode" TEXT,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OutreachReplyForwardIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutreachReplyForwardIntent_replyId_fkey" FOREIGN KEY ("replyId")
    REFERENCES "OutreachReply"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachReplyForwardIntent_bounds_check" CHECK (
    char_length("providerEmailId") BETWEEN 1 AND 256
    AND char_length("fromEmailSnapshot") BETWEEN 3 AND 320
    AND char_length("toEmailSnapshot") BETWEEN 3 AND 320
    AND char_length("subjectSnapshot") BETWEEN 1 AND 1000
    AND char_length("textBodySnapshot") BETWEEN 1 AND 110000
    AND "attachmentCount" BETWEEN 0 AND 100
    AND char_length("idempotencyKey") BETWEEN 1 AND 256
    AND ("claimToken" IS NULL OR char_length("claimToken") BETWEEN 1 AND 128)
    AND ("providerMessageId" IS NULL OR char_length("providerMessageId") BETWEEN 1 AND 512)
    AND ("failureCode" IS NULL OR "failureCode" IN (
      'FORWARD_CONFIGURATION_DRIFT',
      'FORWARD_LOCAL_ENVELOPE_INVALID',
      'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
      'RESEND_FORWARD_REJECTED',
      'RESEND_FORWARD_TIMEOUT',
      'RESEND_FORWARD_TRANSPORT_UNCERTAIN',
      'RESEND_FORWARD_CONCURRENT_IDEMPOTENCY',
      'RESEND_FORWARD_HTTP_UNCERTAIN',
      'RESEND_FORWARD_ACCEPTANCE_INVALID',
      'FORWARD_ACCEPTANCE_PERSISTENCE_FAILED',
      'RESEND_FORWARD_OUTCOME_UNCERTAIN'
    ))
  ),
  CONSTRAINT "OutreachReplyForwardIntent_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "attemptCount" = 0
      AND "claimToken" IS NULL
      AND "claimExpiresAt" IS NULL
      AND "providerDispatchAt" IS NULL
      AND "providerMessageId" IS NULL
      AND "failureCode" IS NULL
      AND "completedAt" IS NULL
    ) OR (
      "status" = 'PROCESSING'
      AND "attemptCount" IN (0, 1)
      AND "claimToken" IS NOT NULL
      AND "claimExpiresAt" IS NOT NULL
      AND (("attemptCount" = 0 AND "providerDispatchAt" IS NULL)
        OR ("attemptCount" = 1 AND "providerDispatchAt" IS NOT NULL))
      AND "providerMessageId" IS NULL
      AND "failureCode" IS NULL
      AND "completedAt" IS NULL
    ) OR (
      "status" = 'DELIVERED'
      AND "attemptCount" = 1
      AND "claimToken" IS NOT NULL
      AND "claimExpiresAt" IS NOT NULL
      AND "providerDispatchAt" IS NOT NULL
      AND "providerMessageId" IS NOT NULL
      AND "failureCode" IS NULL
      AND "completedAt" IS NOT NULL
    ) OR (
      "status" = 'FAILED'
      AND "attemptCount" = 1
      AND "claimToken" IS NOT NULL
      AND "claimExpiresAt" IS NOT NULL
      AND "providerDispatchAt" IS NOT NULL
      AND "providerMessageId" IS NULL
      AND "failureCode" = 'RESEND_FORWARD_REJECTED'
      AND "completedAt" IS NOT NULL
    ) OR (
      "status" = 'RECONCILIATION_REQUIRED'
      AND "attemptCount" = 1
      AND "claimToken" IS NOT NULL
      AND "claimExpiresAt" IS NOT NULL
      AND "providerDispatchAt" IS NOT NULL
      AND "providerMessageId" IS NULL
      AND "failureCode" IN (
        'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
        'RESEND_FORWARD_TIMEOUT',
        'RESEND_FORWARD_TRANSPORT_UNCERTAIN',
        'RESEND_FORWARD_CONCURRENT_IDEMPOTENCY',
        'RESEND_FORWARD_HTTP_UNCERTAIN',
        'RESEND_FORWARD_ACCEPTANCE_INVALID',
        'FORWARD_ACCEPTANCE_PERSISTENCE_FAILED',
        'RESEND_FORWARD_OUTCOME_UNCERTAIN'
      )
      AND "completedAt" IS NOT NULL
    ) OR (
      "status" = 'QUARANTINED'
      AND "attemptCount" = 0
      AND "claimToken" IS NULL
      AND "claimExpiresAt" IS NULL
      AND "providerDispatchAt" IS NULL
      AND "providerMessageId" IS NULL
      AND "failureCode" IN ('FORWARD_CONFIGURATION_DRIFT', 'FORWARD_LOCAL_ENVELOPE_INVALID')
      AND "completedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "OutreachReplyForwardIntent_replyId_key"
  ON "OutreachReplyForwardIntent"("replyId");
CREATE UNIQUE INDEX "OutreachReplyForwardIntent_idempotencyKey_key"
  ON "OutreachReplyForwardIntent"("idempotencyKey");
CREATE UNIQUE INDEX "OutreachReplyForwardIntent_claimToken_key"
  ON "OutreachReplyForwardIntent"("claimToken");
CREATE UNIQUE INDEX "OutreachReplyForwardIntent_providerMessageId_key"
  ON "OutreachReplyForwardIntent"("providerMessageId");
CREATE INDEX "OutreachReplyForwardIntent_status_availableAt_createdAt_id_idx"
  ON "OutreachReplyForwardIntent"("status", "availableAt", "createdAt", "id");
CREATE INDEX "OutreachReplyForwardIntent_status_claimExpiresAt_idx"
  ON "OutreachReplyForwardIntent"("status", "claimExpiresAt");

CREATE FUNCTION outreach_reply_forward_idempotency_key(
  provider_email_id TEXT,
  from_email TEXT,
  to_email TEXT,
  subject_text TEXT,
  body_text TEXT,
  attachment_count INTEGER
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'tft-outreach-reply-forward-v1-' || encode(digest(convert_to(
    octet_length('v1')::TEXT || ':' || 'v1'
    || octet_length(provider_email_id)::TEXT || ':' || provider_email_id
    || octet_length(from_email)::TEXT || ':' || from_email
    || octet_length(to_email)::TEXT || ':' || to_email
    || octet_length(subject_text)::TEXT || ':' || subject_text
    || octet_length(body_text)::TEXT || ':' || body_text
    || octet_length(attachment_count::TEXT)::TEXT || ':' || attachment_count::TEXT,
    'UTF8'
  ), 'sha256'), 'hex');
$$;

CREATE FUNCTION "guard_outreach_reply_forward_intent"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."createdAt" := CURRENT_TIMESTAMP;
    NEW."updatedAt" := CURRENT_TIMESTAMP;
    NEW."availableAt" := CURRENT_TIMESTAMP;
    IF NEW."status" <> 'PENDING'
      OR NEW."attemptCount" <> 0
      OR NEW."claimToken" IS NOT NULL
      OR NEW."claimExpiresAt" IS NOT NULL
      OR NEW."providerDispatchAt" IS NOT NULL
      OR NEW."providerMessageId" IS NOT NULL
      OR NEW."failureCode" IS NOT NULL
      OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'outreach reply forward intent must originate pending';
    END IF;
  END IF;
  IF NEW."idempotencyKey" IS DISTINCT FROM outreach_reply_forward_idempotency_key(
    NEW."providerEmailId",
    NEW."fromEmailSnapshot",
    NEW."toEmailSnapshot",
    NEW."subjectSnapshot",
    NEW."textBodySnapshot",
    NEW."attachmentCount"
  ) THEN
    RAISE EXCEPTION 'outreach reply forward idempotency identity is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "OutreachReply"
    WHERE "id" = NEW."replyId"
      AND "providerEmailId" = NEW."providerEmailId"
  ) THEN
    RAISE EXCEPTION 'outreach reply forward source identity is invalid';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."replyId" IS DISTINCT FROM OLD."replyId"
    OR NEW."providerEmailId" IS DISTINCT FROM OLD."providerEmailId"
    OR NEW."fromEmailSnapshot" IS DISTINCT FROM OLD."fromEmailSnapshot"
    OR NEW."toEmailSnapshot" IS DISTINCT FROM OLD."toEmailSnapshot"
    OR NEW."subjectSnapshot" IS DISTINCT FROM OLD."subjectSnapshot"
    OR NEW."textBodySnapshot" IS DISTINCT FROM OLD."textBodySnapshot"
    OR NEW."attachmentCount" IS DISTINCT FROM OLD."attachmentCount"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."availableAt" IS DISTINCT FROM OLD."availableAt"
  ) THEN
    RAISE EXCEPTION 'outreach reply forward envelope is immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" IN ('DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED', 'QUARANTINED') THEN
      RAISE EXCEPTION 'terminal outreach reply forward intent is immutable';
    END IF;
    IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('PROCESSING', 'QUARANTINED') THEN
      RAISE EXCEPTION 'invalid pending outreach reply forward transition';
    END IF;
    IF OLD."status" = 'PENDING' AND NEW."status" = 'PROCESSING' AND (
      NEW."attemptCount" <> 0
      OR NEW."claimExpiresAt" IS DISTINCT FROM
        (CURRENT_TIMESTAMP + INTERVAL '15 minutes')::TIMESTAMP(3)
    ) THEN
      RAISE EXCEPTION 'outreach reply forward claim does not use the database lease clock';
    END IF;
    IF OLD."status" = 'PENDING' AND NEW."status" = 'QUARANTINED'
      AND (NEW."completedAt" IS DISTINCT FROM CURRENT_TIMESTAMP::TIMESTAMP(3)
        OR NEW."failureCode" NOT IN ('FORWARD_CONFIGURATION_DRIFT', 'FORWARD_LOCAL_ENVELOPE_INVALID')) THEN
      RAISE EXCEPTION 'invalid outreach reply forward quarantine';
    END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 0 THEN
      IF NEW."status" = 'PENDING' THEN
        IF OLD."claimExpiresAt" > CURRENT_TIMESTAMP THEN
          RAISE EXCEPTION 'live pre-dispatch outreach reply forward claim cannot reset';
        END IF;
      ELSIF NOT (NEW."status" = 'PROCESSING' AND NEW."attemptCount" = 1
        AND NEW."claimToken" = OLD."claimToken"
        AND NEW."claimExpiresAt" = OLD."claimExpiresAt"
        AND NEW."providerDispatchAt" = CURRENT_TIMESTAMP::TIMESTAMP(3)) THEN
        RAISE EXCEPTION 'invalid pre-dispatch outreach reply forward transition';
      END IF;
    END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1
      AND NEW."status" NOT IN ('DELIVERED', 'FAILED', 'RECONCILIATION_REQUIRED') THEN
      RAISE EXCEPTION 'invalid dispatched outreach reply forward transition';
    END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1 AND (
      (NEW."status" = 'FAILED' AND NEW."failureCode" <> 'RESEND_FORWARD_REJECTED')
      OR (NEW."status" = 'RECONCILIATION_REQUIRED' AND NEW."failureCode" NOT IN (
        'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
        'RESEND_FORWARD_TIMEOUT',
        'RESEND_FORWARD_TRANSPORT_UNCERTAIN',
        'RESEND_FORWARD_CONCURRENT_IDEMPOTENCY',
        'RESEND_FORWARD_HTTP_UNCERTAIN',
        'RESEND_FORWARD_ACCEPTANCE_INVALID',
        'FORWARD_ACCEPTANCE_PERSISTENCE_FAILED',
        'RESEND_FORWARD_OUTCOME_UNCERTAIN'
      ))
    ) THEN
      RAISE EXCEPTION 'invalid outreach reply forward outcome classification';
    END IF;
    IF OLD."status" = 'PROCESSING' AND NEW."status" <> 'PENDING' AND (
      NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
      OR NEW."claimExpiresAt" IS DISTINCT FROM OLD."claimExpiresAt"
    ) THEN
      RAISE EXCEPTION 'outreach reply forward claim evidence is immutable';
    END IF;
    IF OLD."status" = 'PROCESSING' AND OLD."attemptCount" = 1 AND (
      NEW."attemptCount" <> 1
      OR NEW."providerDispatchAt" IS DISTINCT FROM OLD."providerDispatchAt"
      OR NEW."completedAt" IS DISTINCT FROM CURRENT_TIMESTAMP::TIMESTAMP(3)
    ) THEN
      RAISE EXCEPTION 'outreach reply forward dispatch evidence is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OutreachReplyForwardIntent_guard"
BEFORE INSERT OR UPDATE ON "OutreachReplyForwardIntent"
FOR EACH ROW EXECUTE FUNCTION "guard_outreach_reply_forward_intent"();

CREATE FUNCTION "protect_outreach_reply_forward_intent_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'outreach reply forward intent history is append-only';
END;
$$;

CREATE TRIGGER "OutreachReplyForwardIntent_protect_delete"
BEFORE DELETE ON "OutreachReplyForwardIntent"
FOR EACH ROW EXECUTE FUNCTION "protect_outreach_reply_forward_intent_history"();

CREATE TRIGGER "OutreachReplyForwardIntent_protect_truncate"
BEFORE TRUNCATE ON "OutreachReplyForwardIntent"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_outreach_reply_forward_intent_history"();

CREATE FUNCTION "protect_outreach_reply_forward_source_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."forwardedAt" IS DISTINCT FROM OLD."forwardedAt"
    AND EXISTS (
      SELECT 1 FROM "OutreachReplyForwardIntent" WHERE "replyId" = OLD."id"
    ) AND (
      OLD."forwardedAt" IS NOT NULL
      OR NEW."forwardedAt" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "OutreachReplyForwardIntent"
        WHERE "replyId" = OLD."id"
          AND "status" = 'DELIVERED'
          AND "completedAt" = NEW."forwardedAt"
      )
    ) THEN
    RAISE EXCEPTION 'outreach reply forwarded projection is invalid';
  END IF;
  IF EXISTS (
      SELECT 1 FROM "OutreachReplyForwardIntent" WHERE "replyId" = OLD."id"
    ) AND (
      NEW."providerEmailId" IS DISTINCT FROM OLD."providerEmailId"
      OR NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId"
      OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
      OR NEW."contactId" IS DISTINCT FROM OLD."contactId"
      OR NEW."fromEmail" IS DISTINCT FROM OLD."fromEmail"
      OR NEW."toEmail" IS DISTINCT FROM OLD."toEmail"
      OR NEW."subject" IS DISTINCT FROM OLD."subject"
      OR NEW."textBody" IS DISTINCT FROM OLD."textBody"
      OR NEW."htmlBody" IS DISTINCT FROM OLD."htmlBody"
      OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
      OR NEW."attachmentCount" IS DISTINCT FROM OLD."attachmentCount"
    ) THEN
    RAISE EXCEPTION 'outreach reply forward source identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OutreachReply_protect_forward_source_identity"
BEFORE UPDATE OF "providerEmailId", "providerMessageId", "recipientId", "contactId",
  "fromEmail", "toEmail", "subject", "textBody", "htmlBody", "receivedAt", "attachmentCount",
  "forwardedAt"
ON "OutreachReply"
FOR EACH ROW EXECUTE FUNCTION "protect_outreach_reply_forward_source_identity"();
