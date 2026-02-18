const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const s = await prisma.seller.create({
    data: { name: "Race Buyer", rating: 4.5, reviews: 0, creditBalanceCredits: 0 },
  });
  console.log("BUYER_B_ID=" + s.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
