const Database = require("better-sqlite3");

const oid = process.env.OID;
if (!oid) {
  console.error("Missing OID env var. Example: $env:OID = \"<orderId>\"");
  process.exit(1);
}

const db = new Database("./dev.db", { readonly: true });

const groups = db.prepare(`
  SELECT sellerId, type, source, ticketId, COUNT(*) AS cnt
  FROM "CreditTransaction"
  WHERE orderId = ?
  GROUP BY sellerId, type, source, ticketId
  ORDER BY sellerId ASC, type ASC, source ASC, ticketId ASC
`).all(oid);

console.log(JSON.stringify(groups, null, 2));

db.close();
