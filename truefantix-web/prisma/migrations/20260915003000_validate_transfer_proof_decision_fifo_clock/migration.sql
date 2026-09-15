-- Keep malformed restored seller-decision timestamps from controlling FIFO
-- ordering. The worker still quarantines the malformed envelope itself; this
-- key only makes its ordering position fall back to immutable creation time.
BEGIN;

CREATE OR REPLACE FUNCTION transfer_proof_seller_decision_fifo_clock(
  decision_payload JSONB,
  fallback_clock TIMESTAMP(3)
)
RETURNS TEXT AS $$
DECLARE
  decision_clock_text TEXT;
  decision_clock TIMESTAMP(3);
BEGIN
  decision_clock_text := decision_payload ->> 'decidedAt';
  IF decision_clock_text IS NULL
    OR decision_clock_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
    RETURN TO_CHAR(fallback_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END IF;

  BEGIN
    decision_clock := decision_clock_text::timestamptz AT TIME ZONE 'UTC';
  EXCEPTION
    WHEN datetime_field_overflow OR invalid_datetime_format THEN
      RETURN TO_CHAR(fallback_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END;

  IF TO_CHAR(decision_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      IS DISTINCT FROM decision_clock_text THEN
    RETURN TO_CHAR(fallback_clock, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END IF;

  RETURN decision_clock_text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMIT;
