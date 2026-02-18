const Database = require("better-sqlite3");
const db = new Database("./dev.db", { readonly: true });

const rows = db.prepare(`
  SELECT id, status, reservedByOrderId, reservedUntil
  FROM "Ticket"
  WHERE id IN ('ticket_so_1','ticket_so_2')
  ORDER BY id
`).all();

console.log(JSON.stringify(rows, null, 2));
db.close();
