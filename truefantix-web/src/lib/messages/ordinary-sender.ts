import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountMessageWriteError extends Error {}

export async function runOrdinaryMessageWrite<T>(
  userId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize message mutations against access-token persona restoration so
      // a stale ordinary session cannot leave or alter managed conversation data.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          phone: true,
          termsVersion: true,
          privacyVersion: true,
        },
      });

      if (!current) throw new Error("ACCOUNT_NOT_FOUND");
      if (isPrimaryStagingManagedUser(current)) {
        throw new ManagedAccountMessageWriteError();
      }

      return write(tx);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ManagedAccountMessageWriteError) throw error;

    // Persona restoration can win by aborting this serializable transaction.
    // Reclassify only when the complete managed marker is now present.
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
      throw new ManagedAccountMessageWriteError();
    }
    throw error;
  }
}
