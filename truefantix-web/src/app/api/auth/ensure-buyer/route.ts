export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import {
  isPrimaryStagingManagedUser,
  primaryStagingManagedUserWhere,
} from "@/lib/primary/staging-console";

class ManagedAccountBuyerWalletError extends Error {}

function stagingConsoleOnlyError() {
  const response = NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  // Create a "buyer wallet" Seller record and link it.
  // This does NOT approve selling.
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Re-check the complete managed-identity predicate inside the transaction.
      // A session can pass the outer guard immediately before access-token login
      // restores this row into a staging-only persona.
      const fresh = await tx.user.findUnique({
        where: { id: gate.user.id },
        select: {
          sellerId: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          termsVersion: true,
          privacyVersion: true,
        },
      });

      if (!fresh) throw new Error("ACCOUNT_NOT_FOUND");
      if (isPrimaryStagingManagedUser(fresh)) {
        throw new ManagedAccountBuyerWalletError();
      }

      if (fresh.sellerId) {
        return { sellerId: fresh.sellerId, created: false };
      }

      // Create and attach the wallet in one nested write whose predicate still
      // excludes every managed staging identity. If persona restoration wins,
      // the complete write (including Seller creation) rolls back.
      const linked = await tx.user.update({
        where: {
          id: gate.user.id,
          AND: [
            { sellerId: null },
            { NOT: primaryStagingManagedUserWhere() },
          ],
        },
        data: {
          seller: {
            create: {
              name: `${fresh.firstName} ${fresh.lastName}`.trim(),
              status: "NOT_STARTED",
            },
          },
          // IMPORTANT: do not enable selling here
          canSell: false,
        },
        select: { sellerId: true },
      });

      if (!linked.sellerId) throw new Error("BUYER_WALLET_LINK_FAILED");
      return { sellerId: linked.sellerId, created: true };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ManagedAccountBuyerWalletError) {
      return stagingConsoleOnlyError();
    }

    // A serializable conflict or filtered nested update may be the concurrent
    // persona restoration itself. Reclassify only from the current complete
    // identity; unrelated failures retain their original error.
    const current = await prisma.user.findUnique({
      where: { id: gate.user.id },
      select: {
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
      },
    });
    if (current && isPrimaryStagingManagedUser(current)) {
      return stagingConsoleOnlyError();
    }
    throw error;
  }

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
