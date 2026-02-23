export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const p: any = ctx?.params;
  const resolved = typeof p?.then === "function" ? await p : p;
  const orderId = normalizeId(resolved?.id);
  if (!orderId) return NextResponse.json({ ok: false, error: "Missing order id" }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payment: true },
  });
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

  if (order.status !== "PAID" && order.status !== "DELIVERED" && order.status !== "COMPLETED") {
    return NextResponse.json({ ok: false, error: "Order is not in deliverable state" }, { status: 409 });
  }

  const now = new Date();
  const updated: string[] = [];

  for (const item of order.items) {
    const escrow = await prisma.ticketEscrow.upsert({
      where: { ticketId: item.ticketId },
      create: {
        ticketId: item.ticketId,
        orderId: order.id,
        state: "RELEASED_TO_BUYER",
        releasedAt: now,
        releasedTo: "BUYER",
      },
      update: {
        orderId: order.id,
        state: "RELEASED_TO_BUYER",
        releasedAt: now,
        releasedTo: "BUYER",
        failureReason: null,
      },
    });
    updated.push(escrow.ticketId);
  }

  return NextResponse.json({ ok: true, orderId, updatedTicketIds: updated });
}
