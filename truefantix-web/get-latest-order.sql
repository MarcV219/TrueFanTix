SELECT id, status, buyerSellerId, sellerId, createdAt
FROM "Order"
WHERE buyerSellerId = 'buyer_so'
ORDER BY createdAt DESC
LIMIT 5;
