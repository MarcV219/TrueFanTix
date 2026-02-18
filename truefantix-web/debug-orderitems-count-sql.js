const Database = require("better-sqlite3");

const oid = process.env.OID;
if (!oid) {
  console.error("Missing OID env var. Example: $env:OID = \"<orderId>\"");
  process.exit(1);
}

const db = new Database("./dev.db", { readonly: true });

const rows = db.prepare(`
  SELECT orderId, COUNT(*) AS cnt
  FROM "OrderItem"
  WHERE orderId = ?
`).all(oid);

console.log(JSON.stringify(rows, null, 2));
db.close();
