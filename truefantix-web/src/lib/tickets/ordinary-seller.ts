import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountListingMutationError extends Error {}
export class SellerListingAccessChangedError extends Error {}

type CurrentListingSeller = {
  id: string;
  seller: {
    id: string;
  };
};

export async function runOrdinaryListingMutation<T>(
  userId: string,
  operation: (
    tx: Prisma.TransactionClient,
    current: CurrentListingSeller,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Keep listing provider reads and persistence behind the same identity
        // lock so access-token persona restoration cannot reuse a stale seller
        // session to inspect or mutate managed-account listing data.
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
                status: true,
              },
            },
          },
        });

        if (!current || current.isBanned) throw new SellerListingAccessChangedError();
        if (isPrimaryStagingManagedUser(current)) {
          throw new ManagedAccountListingMutationError();
        }
        if (!current.canSell || current.seller?.status !== "APPROVED") {
          throw new SellerListingAccessChangedError();
        }

        return operation(tx, {
          id: current.id,
          seller: { id: current.seller.id },
        });
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountListingMutationError) throw error;

    // A concurrent persona restoration can surface as a serialization abort.
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
      throw new ManagedAccountListingMutationError();
    }
    throw error;
  }
}
