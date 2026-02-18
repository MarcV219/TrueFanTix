-- Prevent zero-value credit transactions (INSERT)
CREATE TRIGGER IF NOT EXISTS "credittransaction_amount_nonzero_insert"
BEFORE INSERT ON "CreditTransaction"
FOR EACH ROW
WHEN NEW."amountCredits" = 0
BEGIN
  SELECT RAISE(ABORT, 'amountCredits must be non-zero');
END;

-- Prevent zero-value credit transactions (UPDATE)
CREATE TRIGGER IF NOT EXISTS "credittransaction_amount_nonzero_update"
BEFORE UPDATE ON "CreditTransaction"
FOR EACH ROW
WHEN NEW."amountCredits" = 0
BEGIN
  SELECT RAISE(ABORT, 'amountCredits must be non-zero');
END;
