const Database = require("better-sqlite3");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const { PrismaClient } = require("@prisma/client");

const oid = process.env.OID;

const db = new Database("./dev.db");
const adapter = new PrismaBetterSqlite3(db);
const prisma = new PrismaClient({ adapter });

(async () => {
  const rows = await prisma.creditTransaction.findMany({
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
    orderBy: [
      { sellerId: "asc" },
      { type: "asc" },
      { ticketId: "asc" },
      { createdAt: "asc" },
    ],
  });

  console.log(JSON.stringify(rows, null, 2));
  await prisma["$disconnect"]();
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
