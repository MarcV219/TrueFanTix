// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * We support DATABASE_URL values like:
 *   file:./prisma/dev.db
 *   "file:./prisma/dev.db"   (quotes in .env are common)
 *
 * BUT the better-sqlite3 driver wants a *real filesystem path*:
 *   C:\...\prisma\dev.db
 *
 * So we convert file: URLs to OS paths before passing to the adapter.
 */

function stripOuterQuotes(v: string) {
  const s = v.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function fileUrlToFsPath(fileUrl: string) {
  // Accept forms:
  // - file:./dev.db
  // - file:../dev.db
  // - file:/C:/path/dev.db
  // - file:///C:/path/dev.db
  // - file:/home/user/dev.db
  let v = fileUrl.trim();

  if (!v.startsWith("file:")) {
    // Already a path
    return v;
  }

  v = v.slice("file:".length);

  // Strip leading slashes that appear in file:/ or file:///
  // Example: "/C:/x/y.db" or "///C:/x/y.db" -> "C:/x/y.db"
  while (v.startsWith("/")) v = v.slice(1);

  // Decode URL-encoded characters just in case
  try {
    v = decodeURIComponent(v);
  } catch {
    // ignore
  }

  // If it was relative (./ or ../), resolve from project root
  if (v.startsWith("./") || v.startsWith("../")) {
    return path.resolve(process.cwd(), v);
  }

  // Otherwise treat as absolute (Windows "C:/..." or Linux "/..." already stripped to "home/..")
  // For *nix absolute paths we removed one leading slash above, so restore it.
  // Heuristic: if it looks like "C:/", keep it; otherwise assume unix-like and re-add "/".
  if (/^[A-Za-z]:[\\/]/.test(v)) return v;
  return "/" + v;
}

function pickDbFilePath(): string {
  const raw = process.env.DATABASE_URL ? stripOuterQuotes(process.env.DATABASE_URL) : "";
  if (raw && raw.trim()) {
    // DATABASE_URL is primarily for Prisma (migrations / schema), but we can reuse it here
    // by converting file: URL -> filesystem path for better-sqlite3.
    return fileUrlToFsPath(raw.trim());
  }

  // Default: prisma/dev.db (matches your project structure)
  return path.resolve(process.cwd(), "prisma", "dev.db");
}

const dbFilePath = pickDbFilePath();

// Ensure the directory exists (prevents "directory does not exist")
try {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
} catch {
  // ignore
}

// Prisma v7+ driver adapters require passing an adapter.
const adapter = new PrismaBetterSqlite3({ url: dbFilePath });

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
