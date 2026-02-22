export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CreditTxSource, CreditTxType } from "@prisma/client";

// Legacy endpoint kept for compatibility; semantics are access tokens.
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const sellerId = String(body?.sellerId ?? "").trim();
    const amount = Number(body?.amount);
    const reason = String(body?.reason ?? "").trim();
    const ticketId = body?.ticketId ? String(body.ticketId).trim() : null;

    if (!sellerId || !Number.isFinite(amount) || !reason) {
      return NextResponse.json(
        { error: "sellerId, amount (number), and reason are required" },
        { status: 400 }
      );
    }

    const intAmount = Math.trunc(amount);
    if (intAmount === 0) {
      return NextResponse.json({ error: "amount cannot be 0" }, { status: 400 });
    }

    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextBalance = (seller.creditBalanceCredits ?? 0) + intAmount;

      await tx.creditTransaction.create({
        data: {
          sellerId,
          type: intAmount > 0 ? CreditTxType.ADJUSTMENT : CreditTxType.REVERSAL,
          source: CreditTxSource.UNKNOWN,
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
