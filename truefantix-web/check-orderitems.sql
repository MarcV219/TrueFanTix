SELECT id, orderId, ticketId, createdAt
FROM "OrderItem"
WHERE ticketId IN ('ticket_so_1','ticket_so_2')
ORDER BY createdAt DESC;
