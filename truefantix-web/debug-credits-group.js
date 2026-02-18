const Database = require("better-sqlite3");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const { PrismaClient } = require("@prisma/client");

const oid = process.env.OID;

const db = new Database("./dev.db");
const adapter = new PrismaBetterSqlite3(db);
const prisma = new PrismaClient({ adapter });

(async () => {
  const groups = await prisma.creditTransaction.groupBy({
    by: ["sellerId","type","source","ticketId"],
    where: { orderId: oid },
    _count: { _all: true },
    orderBy: [
      { sellerId: "asc" },
      { type: "asc" },
      { source: "asc" },
      { ticketId: "asc" },
    ],
  });

  console.log(JSON.stringify(groups, null, 2));
  await prisma["$disconnect"]();
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
