UPDATE "CreditTransaction"
SET source = 'UNKNOWN'
WHERE source IS NULL;
