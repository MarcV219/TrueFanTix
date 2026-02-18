const Database = require("better-sqlite3");

const k = process.env.K;
if (!k) {
  console.error("Missing K env var. Example: $env:K = \"<idempotencyKey>\"");
  process.exit(1);
}

const db = new Database("./dev.db", { readonly: true });

const rows = db.prepare(`
  SELECT id, idempotencyKey, status, createdAt
  FROM "Order"
  WHERE idempotencyKey = ?
`).all(k);

console.log(JSON.stringify(rows, null, 2));
db.close();
