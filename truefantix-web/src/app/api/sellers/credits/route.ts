export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { schemas, validateRequest } from "@/lib/validation";
// Legacy endpoint kept for compatibility; semantics are access tokens.
export async function POST(req: Request) {
  try {
    const validation = await validateRequest(schemas.sellerCreditsAdjustApi)(req);
    if (!validation.success) return validation.response;

    const { sellerId, amount: intAmount, reason, ticketId = null } = validation.data;

    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const nextBalance = (seller.creditBalanceCredits ?? 0) + intAmount;

      await tx.creditTransaction.create({
        data: {
          sellerId,
          type: intAmount > 0 ? "ADJUSTMENT" : "REVERSAL",
          source: "UNKNOWN",
          amountCredits: intAmount,
          balanceAfterCredits: nextBalance,
          note: reason,
          ticketId,
        },
      });

      return tx.seller.update({
        where: { id: sellerId },
        data: { creditBalanceCredits: nextBalance },
      });
    });

    return NextResponse.json({
      ok: true,
      accessTokenBalance: updated.creditBalanceCredits,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
