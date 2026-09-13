import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountCatalogRequestWriteError extends Error {}

export async function runOrdinaryCatalogRequestWrite<T>(
  userId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Keep catalog resolution, user-scoped persistence, and the optional
        // admin delivery serialized against staging-persona restoration. This
        // prevents a stale ordinary session from leaving request, preference, or
        // delivery residue after the account has become console-managed.
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
          throw new ManagedAccountCatalogRequestWriteError();
        }

        return write(tx);
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountCatalogRequestWriteError) throw error;

    // Persona restoration may win by aborting this serializable transaction.
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
      throw new ManagedAccountCatalogRequestWriteError();
    }
    throw error;
  }
}
