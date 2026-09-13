import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountReferralWriteError extends Error {}

const managedMarkerSelect = {
  email: true,
  phone: true,
  termsVersion: true,
  privacyVersion: true,
} as const;

async function findManagedUser(userIds: string[]) {
  for (const userId of userIds) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: managedMarkerSelect,
    });
    if (current && isPrimaryStagingManagedUser(current)) return current;
  }
  return null;
}

export async function runOrdinaryReferralWrite<T>(
  userIds: string[],
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const orderedUserIds = [...new Set(userIds)].sort();

  try {
    return await prisma.$transaction(async (tx) => {
      // Lock every referral participant in a deterministic order. Persona
      // restoration updates the same User row, so it cannot race a stale
      // ordinary session into referral, reward, or notification residue.
      for (const userId of orderedUserIds) {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: managedMarkerSelect,
        });

        if (!current) throw new Error("ACCOUNT_NOT_FOUND");
        if (isPrimaryStagingManagedUser(current)) {
          throw new ManagedAccountReferralWriteError();
        }
      }

      return write(tx);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ManagedAccountReferralWriteError) throw error;

    // Persona restoration may win by aborting this serializable transaction.
    // Reclassify only when one of the exact participants is now managed.
    if (await findManagedUser(orderedUserIds)) {
      throw new ManagedAccountReferralWriteError();
    }
    throw error;
  }
}
