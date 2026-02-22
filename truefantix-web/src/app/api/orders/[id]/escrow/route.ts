export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { deriveEscrowState } from "@/lib/escrow";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  const p: any = ctx?.params;
  const resolved = typeof p?.then === "function" ? await p : p;
  const orderId = normalizeId(resolved?.id);

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "Missing order id" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      payment: true,
      items: { include: { ticket: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const isBuyer = order.buyerSellerId === gate.user.sellerId;
  const isSeller = order.sellerId === gate.user.sellerId;
  if (!isBuyer && !isSeller && gate.user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const escrowState = deriveEscrowState({
    orderStatus: order.status,
    paymentStatus: order.payment?.status ?? null,
  });

  return NextResponse.json({
    ok: true,
    escrow: {
      orderId: order.id,
      state: escrowState,
      orderStatus: order.status,
      paymentStatus: order.payment?.status ?? null,
      amountCents: order.amountCents,
      adminFeeCents: order.adminFeeCents,
      totalCents: order.totalCents,
      fundedAt: order.payment?.status === "SUCCEEDED" ? order.payment.updatedAt : null,
      releasable: escrowState === "RELEASE_READY",
      released: escrowState === "RELEASED",
      refunded: escrowState === "REFUNDED",
    },
  });
}
