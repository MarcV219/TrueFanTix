import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountSellerOnboardingError extends Error {}

type CurrentSellerOnboardingUser = {
  id: string;
  canSell: boolean;
  seller: {
    id: string;
    stripeAccountId: string | null;
  } | null;
};

export async function runOrdinarySellerOnboardingOperation<T>(
  userId: string,
  operation: (
    tx: Prisma.TransactionClient,
    current: CurrentSellerOnboardingUser,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Hold the current identity lock through provider inspection and local
        // persistence so access-token persona restoration cannot turn a stale
        // ordinary session into managed-account provider or seller activity.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            phone: true,
            termsVersion: true,
            privacyVersion: true,
            isBanned: true,
            canSell: true,
            seller: {
              select: {
                id: true,
                stripeAccountId: true,
              },
            },
          },
        });

        if (!current || current.isBanned) throw new Error("ACCOUNT_NOT_FOUND");
        if (isPrimaryStagingManagedUser(current)) {
          throw new ManagedAccountSellerOnboardingError();
        }

        return operation(tx, current);
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountSellerOnboardingError) throw error;

    // Persona restoration can win by aborting the serializable transaction.
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
      throw new ManagedAccountSellerOnboardingError();
    }
    throw error;
  }
}
