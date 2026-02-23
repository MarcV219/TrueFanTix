export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

export async function POST(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  // If already linked, return it
  if (gate.user.sellerId) {
    return NextResponse.json(
      { ok: true, sellerId: gate.user.sellerId, created: false },
      { status: 200 }
    );
  }

  // Create a "buyer wallet" Seller record and link it.
  // This does NOT approve selling.
  const result = await prisma.$transaction(async (tx: any) => {
    // Re-check inside the transaction to avoid race conditions
    const fresh = await tx.user.findUnique({
      where: { id: gate.user.id },
      select: { sellerId: true, firstName: true, lastName: true },
    });

    if (fresh?.sellerId) {
      return { sellerId: fresh.sellerId, created: false };
    }

    const seller = await tx.seller.create({
      data: {
        name: `${gate.user.firstName} ${gate.user.lastName}`.trim(),
        status: "NOT_STARTED",
      },
      select: { id: true },
    });

    await tx.user.update({
      where: { id: gate.user.id },
      data: {
        sellerId: seller.id,
        // IMPORTANT: do not enable selling here
        canSell: false,
      },
    });

    return { sellerId: seller.id, created: true };
  });

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
