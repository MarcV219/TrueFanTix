const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name = 'event_sellout_immutable_after_order';
  `);

  console.log(result);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
