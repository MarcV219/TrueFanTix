export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    // Access tokens are integer units (1 token per eligible ticket event).
    const intAmount = Math.trunc(amount);
    if (intAmount === 0) {
      return NextResponse.json({ error: "amount cannot be 0" }, { status: 400 });
    }

    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    // 1) Record the transaction
    await prisma.creditTransaction.create({
      data: {
        sellerId,
        amount: intAmount,
        reason,
        ticketId,
      },
    });

    // 2) Recalculate seller balance from the ledger
    const agg = await prisma.creditTransaction.aggregate({
      where: { sellerId },
      _sum: { amount: true },
    });

    const newBalance = agg._sum.amount ?? 0;

    // 3) Store the balance for fast reads
    const updated = await prisma.seller.update({
      where: { id: sellerId },
      data: { creditBalance: newBalance },
    });

    return NextResponse.json({
      ok: true,
      accessTokenBalance: updated.creditBalance,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
