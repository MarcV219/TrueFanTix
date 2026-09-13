import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountReviewTranslationError extends Error {}

type CurrentReviewTranslationUser = {
  seller: { id: string } | null;
};

export async function runOrdinaryReviewTranslation<T>(
  userId: string,
  operation: (
    tx: Prisma.TransactionClient,
    current: CurrentReviewTranslationUser,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Review lookup and provider translation must not race access-token
        // persona restoration. Hold the user lock through the provider call so
        // a stale ordinary session cannot disclose managed review content.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            email: true,
            phone: true,
            termsVersion: true,
            privacyVersion: true,
            seller: { select: { id: true } },
          },
        });

        if (!current) throw new Error("ACCOUNT_NOT_FOUND");
        if (isPrimaryStagingManagedUser(current)) {
          throw new ManagedAccountReviewTranslationError();
        }

        return operation(tx, current);
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountReviewTranslationError) throw error;

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
      throw new ManagedAccountReviewTranslationError();
    }
    throw error;
  }
}
