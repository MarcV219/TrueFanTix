import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountPurchaseError extends Error {}

export type BuyerPurchaseAccessErrorCode =
  | "NOT_AUTHENTICATED"
  | "BANNED"
  | "NOT_VERIFIED"
  | "BUYING_DISABLED"
  | "BUYER_WALLET_MISSING";

export class BuyerPurchaseAccessChangedError extends Error {
  constructor(readonly code: BuyerPurchaseAccessErrorCode) {
    super(code);
  }
}

type CurrentBuyer = {
  id: string;
  seller: {
    id: string;
    accessTokenBalance: number;
  };
};

export async function runOrdinaryPurchase<T>(
  userId: string,
  operation: (
    tx: Prisma.TransactionClient,
    current: CurrentBuyer,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Keep the buyer identity, wallet, reservation, and order mutation behind
        // one lock so access-token persona restoration cannot reuse a stale
        // ordinary session between the route guard and purchase persistence.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            phone: true,
            termsVersion: true,
            privacyVersion: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            isBanned: true,
            canBuy: true,
            seller: {
              select: {
                id: true,
                accessTokenBalance: true,
              },
            },
          },
        });

        if (!current) throw new BuyerPurchaseAccessChangedError("NOT_AUTHENTICATED");
        if (isPrimaryStagingManagedUser(current)) throw new ManagedAccountPurchaseError();
        if (current.isBanned) throw new BuyerPurchaseAccessChangedError("BANNED");
        if (!current.emailVerifiedAt || !current.phoneVerifiedAt) {
          throw new BuyerPurchaseAccessChangedError("NOT_VERIFIED");
        }
        if (!current.canBuy) throw new BuyerPurchaseAccessChangedError("BUYING_DISABLED");
        if (!current.seller) throw new BuyerPurchaseAccessChangedError("BUYER_WALLET_MISSING");

        return operation(tx, {
          id: current.id,
          seller: current.seller,
        });
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountPurchaseError) throw error;

    // Reclassify a serialization abort only when persona restoration has now
    // installed a complete managed marker. Unrelated purchase failures retain
    // their original error and response contract.
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
      throw new ManagedAccountPurchaseError();
    }
    throw error;
  }
}
