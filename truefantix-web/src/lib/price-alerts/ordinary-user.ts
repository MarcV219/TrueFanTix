import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountPriceAlertWriteError extends Error {}

export async function runOrdinaryPriceAlertWrite<T>(
  userId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize price-alert mutations against access-token persona restoration
      // so a stale ordinary session cannot leave alert or notification residue.
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
        throw new ManagedAccountPriceAlertWriteError();
      }

      return write(tx);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ManagedAccountPriceAlertWriteError) throw error;

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
      throw new ManagedAccountPriceAlertWriteError();
    }
    throw error;
  }
}
