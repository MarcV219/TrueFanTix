import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountSpotifyOperationError extends Error {}

export async function runOrdinarySpotifyOperation<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Spotify token use, provider requests, and user-scoped persistence
        // must not race access-token persona restoration. External notification
        // delivery occurs only after this transaction commits.
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
          throw new ManagedAccountSpotifyOperationError();
        }

        return operation(tx);
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountSpotifyOperationError) throw error;

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
      throw new ManagedAccountSpotifyOperationError();
    }
    throw error;
  }
}
