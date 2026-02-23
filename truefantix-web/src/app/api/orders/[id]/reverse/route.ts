export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireAdmin } from "@/lib/auth/guards";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const params = await ctx.params;
    const orderId = params?.id;
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Order ID is required." },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // 1) Load order with items and related ticket
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { ticket: true } },
          payment: true,
          buyer: { include: { user: true } },
        },
      });

      if (!order) {
        return { ok: false, error: "NOT_FOUND", message: "Order not found." };
      }

      // Only allow reverse for paid/delivered/completed orders
      const allowed = ["PAID", "DELIVERED", "COMPLETED"];
      if (!allowed.includes(order.status)) {
        return {
          ok: false,
          error: "BAD_STATE",
          message: `Cannot reverse order in status: ${order.status}`,
        };
      }

      // 2) Mark order as cancelled
      await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED", updatedAt: new Date() },
      });

      // 3) Restore tickets to AVAILABLE and clear order linkage
      const ticketIds: string[] = order.items.map((item: any) => item.ticketId);
      if (ticketIds.length > 0) {
        await tx.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: { status: "AVAILABLE", reservedByOrderId: null, updatedAt: new Date() },
        });
      }

      // 4) Reverse buyer spend ledger entries for this order
      const buyerSpend = await tx.creditTransaction.findMany({
        where: {
          userId: order.buyerId,
          ticketId: { in: ticketIds },
          kind: "SPEND",
        },
      });
      for (const t of buyerSpend) {
        await tx.creditTransaction.create({
          data: {
            userId: t.userId,
            ticketId: t.ticketId,
            orderId: t.orderId,
            amount: -t.amount,
            kind: "SPEND",
            description: "Reversed",
            status: "COMPLETED",
            createdAt: new Date(),
          },
        });
      }

      return { ok: true, message: "Order reversed and tickets restored." };
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, message: result.message },
        { status: result.error === "NOT_FOUND" ? 404 : 400 }
      );
    }

    return NextResponse.json({ ok: true, message: result.message });
  } catch (err: any) {
    console.error("POST /api/orders/[id]/reverse error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not reverse order." },
      { status: 500 }
    );
  }
}
