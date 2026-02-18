const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync("./dev.db");

const rows = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type='trigger'
    AND name='event_sellout_immutable_after_order';
`).all();

console.log(JSON.stringify(rows, null, 2));

db.close();
