import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountPricingOperationError extends Error {}

type CurrentPricingUser = {
  seller: { id: string } | null;
};

export async function runOrdinaryPricingOperation<T>(
  userId: string,
  operation: (
    tx: Prisma.TransactionClient,
    current: CurrentPricingUser,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Keep authenticated pricing reads serialized against access-token
        // persona restoration so a stale ordinary session cannot query through
        // a managed identity or use an obsolete seller relationship.
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
          throw new ManagedAccountPricingOperationError();
        }

        return operation(tx, current);
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountPricingOperationError) throw error;

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
      throw new ManagedAccountPricingOperationError();
    }
    throw error;
  }
}
