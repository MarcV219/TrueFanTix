SELECT sellerId, type, source, amountCredits, orderId, ticketId, createdAt
FROM "CreditTransaction"
WHERE orderId = 'cml2npxvt000eswun0zs6vwuz'
ORDER BY sellerId, type, ticketId, createdAt;
