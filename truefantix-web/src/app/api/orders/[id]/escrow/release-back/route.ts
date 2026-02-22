export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketEscrowState, TicketStatus } from "@prisma/client";
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

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

  const now = new Date();
  const reverted: string[] = [];

  for (const item of order.items) {
    await prisma.ticket.update({
      where: { id: item.ticketId },
      data: {
        status: TicketStatus.AVAILABLE,
        reservedByOrderId: null,
        reservedUntil: null,
      },
    });

    const escrow = await prisma.ticketEscrow.upsert({
      where: { ticketId: item.ticketId },
      create: {
        ticketId: item.ticketId,
        orderId: order.id,
        state: TicketEscrowState.RELEASED_BACK_TO_SELLER,
        releasedAt: now,
        releasedTo: "SELLER",
      },
      update: {
        orderId: order.id,
        state: TicketEscrowState.RELEASED_BACK_TO_SELLER,
        releasedAt: now,
        releasedTo: "SELLER",
      },
    });

    reverted.push(escrow.ticketId);
  }

  return NextResponse.json({ ok: true, orderId, revertedTicketIds: reverted });
}
