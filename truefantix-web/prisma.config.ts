// prisma.config.ts (project root)
import "dotenv/config";
import { defineConfig, env } from "@prisma/config";

export default defineConfig({
  // IMPORTANT: point to your schema file path
  schema: "prisma/schema.prisma",

  datasource: {
    // Prisma 7 expects the DB connection URL here
    url: env("DATABASE_URL"),
  },
});
