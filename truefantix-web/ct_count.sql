SELECT
  "orderId",
  COUNT(*) AS txCount,
  SUM("amountCredits") AS sumAmountCredits
FROM "CreditTransaction"
WHERE "orderId" = 'cmkvok2oz000g7wunr7ols6x2'
GROUP BY "orderId";
