const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name = 'event_sellout_immutable_after_order';
  `;

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
