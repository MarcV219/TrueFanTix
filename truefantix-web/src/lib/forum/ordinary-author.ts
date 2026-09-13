import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountForumWriteError extends Error {}
export class ForumCommentingDisabledError extends Error {}

export async function runOrdinaryForumWrite<T>(
  userId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize ordinary forum content against access-token persona
      // restoration so a stale session cannot write as a managed persona.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          phone: true,
          termsVersion: true,
          privacyVersion: true,
          canComment: true,
        },
      });

      if (!current) throw new Error("ACCOUNT_NOT_FOUND");
      if (isPrimaryStagingManagedUser(current)) throw new ManagedAccountForumWriteError();
      if (current.canComment !== true) throw new ForumCommentingDisabledError();

      return write(tx);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (
      error instanceof ManagedAccountForumWriteError
      || error instanceof ForumCommentingDisabledError
    ) {
      throw error;
    }

    // Persona restoration may win by making this serializable transaction
    // abort. Reclassify only when the complete managed marker is now present.
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
      },
    });
    if (current && isPrimaryStagingManagedUser(current)) {
      throw new ManagedAccountForumWriteError();
    }
    throw error;
  }
}
