const Database = require("better-sqlite3");
const db = new Database("./dev.db", { readonly: true });

const row = db.prepare(`
  SELECT COUNT(*) AS nullCount
  FROM "CreditTransaction"
  WHERE source IS NULL;
`).get();

console.log(row);
db.close();
