const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

// Use env if present; otherwise default to ./dev.db in project root
const dbPath = path.join(process.cwd(), "dev.db");
const url = process.env.DATABASE_URL ?? `file:${dbPath}`;

const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

module.exports = { prisma };
