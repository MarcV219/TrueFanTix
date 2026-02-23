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
      return NextResponse.json({ ok: true, payouts: [] }, { status: 200 });
    }

    const payouts = await prisma.payout.findMany({
      where: { sellerId: user.seller.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        amountCents: true,
        feeCents: true,
        netCents: true,
        provider: true,
        providerRef: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      payouts: payouts.map((p: any) => ({
        ...p,
        amount: p.amountCents / 100,
        fee: p.feeCents / 100,
        net: p.netCents / 100,
      })),
    });
  } catch (err: any) {
    console.error("GET /api/account/transactions/payouts error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load payouts." },
      { status: 500 }
    );
  }
}
