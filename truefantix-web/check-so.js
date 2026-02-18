const { prisma } = require("./prisma-node");

async function main() {
  const oid = process.argv[2];
  if (!oid) throw new Error("Usage: node check-so.js <ORDER_ID>");

  const sellers = await prisma.seller.findMany({
    where: { id: { in: ["buyer_so", "seller_so"] } },
    select: { id: true, creditBalanceCredits: true },
    orderBy: { id: "asc" },
  });

  const txs = await prisma.creditTransaction.findMany({
    where: { orderId: oid },
    select: {
      sellerId: true,
      type: true,
      source: true,
      amountCredits: true,
      orderId: true,
      ticketId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(JSON.stringify({ sellers, txs }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
