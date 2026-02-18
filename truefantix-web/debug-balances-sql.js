const Database = require("better-sqlite3");
const db = new Database("./dev.db", { readonly: true });

const rows = db.prepare(`
  SELECT id, creditBalanceCredits
  FROM "Seller"
  WHERE id IN ('buyer_so','seller_so')
  ORDER BY id
`).all();

console.log(JSON.stringify(rows, null, 2));
db.close();
