const Database = require("better-sqlite3");

const oid = process.env.OID;
if (!oid) {
  console.error("Missing OID env var. Example: $env:OID = \"<orderId>\"");
  process.exit(1);
}

const db = new Database("./dev.db", { readonly: true });

const rows = db.prepare(`
  SELECT sellerId, type, source, amountCredits, orderId, ticketId, createdAt
  FROM "CreditTransaction"
  WHERE orderId = ?
  ORDER BY sellerId ASC, type ASC, ticketId ASC, createdAt ASC
`).all(oid);

console.log(JSON.stringify(rows, null, 2));

db.close();
