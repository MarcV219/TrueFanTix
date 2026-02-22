export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      include: { seller: true },
    });

    if (!user?.seller) {
      return NextResponse.json(
        { ok: true, accessTokenBalance: 0, transactions: [] },
        { status: 200 }
      );
    }

    const transactions = await prisma.creditTransaction.findMany({
      where: { sellerId: user.seller.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        source: true,
        amountCredits: true,
        balanceAfterCredits: true,
        note: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        accessTokenBalance: user.seller.creditBalanceCredits ?? 0,
        transactions,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/account/access-tokens error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load access tokens." },
      { status: 500 }
    );
  }
}
