SELECT sellerId, type, source, ticketId, COUNT(*) AS cnt
FROM "CreditTransaction"
WHERE orderId = 'cml2npxvt000eswun0zs6vwuz'
GROUP BY sellerId, type, source, ticketId
ORDER BY sellerId, type, ticketId;
