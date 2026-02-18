const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync("./dev.db");

const tables = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type='table'
  ORDER BY name;
`).all();

console.log("TABLES:");
console.log(tables.map(t => t.name));

const orderish = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type='table' AND name LIKE '%Order%';
`).all();

console.log("\nTABLES LIKE %Order%:");
console.log(JSON.stringify(orderish, null, 2));

db.close();
