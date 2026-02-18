// check-forum-models.js
// Purpose: confirm Prisma Client exposes the forum models (forumThread/forumPost)
// without relying on prisma.config.ts behavior.
//
// We set DATABASE_URL for this one script run so PrismaClient can initialize.
process.env.DATABASE_URL = "file:./dev.db";

const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();

  const keys = Object.keys(prisma).filter((k) =>
    k.toLowerCase().includes("forum")
  );

  console.log(keys);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
