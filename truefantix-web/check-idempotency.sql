SELECT id, idempotencyKey, status, createdAt
FROM "Order"
WHERE idempotencyKey = 'c3a3b7cb-cb13-4088-95f6-6b8d6e837a59';
