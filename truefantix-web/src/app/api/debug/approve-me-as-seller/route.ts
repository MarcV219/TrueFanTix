export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 }
    );
  }

  const userId = await getUserIdFromSessionCookie();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "NOT_AUTHENTICATED", message: "Please log in." },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, sellerId: true },
  });

  if (!user?.sellerId) {
    return NextResponse.json(
      { ok: false, error: "SELLER_LINK_MISSING", message: "No seller profile linked to this user." },
      { status: 409 }
    );
  }

  const updatedSeller = await prisma.seller.update({
    where: { id: user.sellerId },
    data: {
      status: "APPROVED",
      statusUpdatedAt: new Date(),
      statusReason: "DEV approval",
    },
    select: { id: true, status: true, statusUpdatedAt: true, statusReason: true },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { canSell: true },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, seller: updatedSeller }, { status: 200 });
}
