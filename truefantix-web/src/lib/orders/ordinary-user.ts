import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountOrderOperationError extends Error {}

export type OrderOperationAccessErrorCode = "NOT_AUTHENTICATED" | "BANNED";

export class OrderOperationAccessChangedError extends Error {
  constructor(readonly code: OrderOperationAccessErrorCode) {
    super(code);
  }
}

type CurrentOrderUser = {
  id: string;
  sellerId: string | null;
};

export async function runOrdinaryOrderOperation<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient, current: CurrentOrderUser) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Keep order reads, mutations, and delivery intent behind the current
        // identity lock so a staging-persona restoration cannot reuse a stale
        // ordinary session at an order workflow boundary.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            sellerId: true,
            email: true,
            phone: true,
            termsVersion: true,
            privacyVersion: true,
            isBanned: true,
          },
        });

        if (!current) throw new OrderOperationAccessChangedError("NOT_AUTHENTICATED");
        if (isPrimaryStagingManagedUser(current)) {
          throw new ManagedAccountOrderOperationError();
        }
        if (current.isBanned) throw new OrderOperationAccessChangedError("BANNED");

        return operation(tx, { id: current.id, sellerId: current.sellerId });
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountOrderOperationError) throw error;

    // Reclassify a serialization abort only after restoration has installed a
    // complete managed marker. Unrelated order failures keep their contract.
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
      throw new ManagedAccountOrderOperationError();
    }
    throw error;
  }
}
