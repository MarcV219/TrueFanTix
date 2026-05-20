export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
// Legacy endpoint kept for compatibility; semantics are access tokens.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const validation = await validateRequest(schemas.sellerAccessTokensAdjustApi)(req);
    if (!validation.success) return validation.response;

    const { sellerId, amount: intAmount, reason, ticketId = null } = validation.data;

    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const nextBalance = (seller.accessTokenBalance ?? 0) + intAmount;

      await tx.accessTokenTransaction.create({
        data: {
          sellerId,
          type: intAmount > 0 ? "ADJUSTMENT" : "REVERSAL",
          source: "UNKNOWN",
          amountAccessTokens: intAmount,
          balanceAfterAccessTokens: nextBalance,
          note: reason,
          ticketId,
        },
      });

      return tx.seller.update({
        where: { id: sellerId },
        data: { accessTokenBalance: nextBalance },
      });
    });

    return NextResponse.json({
      ok: true,
      accessTokenBalance: updated.accessTokenBalance,
      credits: updated.accessTokenBalance,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
