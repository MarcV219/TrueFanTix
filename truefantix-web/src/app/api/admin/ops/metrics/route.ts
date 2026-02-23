export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    ordersPaid,
    ordersDelivered,
    ordersCompleted,
    ordersCancelled,
    failedEmails,
    pendingPayouts,
    escrowIn,
  ] = await Promise.all([
    prisma.order.count({ where: { status: "PAID", createdAt: { gte: dayAgo } } }),
    prisma.order.count({ where: { status: "DELIVERED", createdAt: { gte: dayAgo } } }),
    prisma.order.count({ where: { status: "COMPLETED", createdAt: { gte: dayAgo } } }),
    prisma.order.count({ where: { status: "CANCELLED", createdAt: { gte: dayAgo } } }),
    prisma.emailDelivery.count({ where: { status: "FAILED", sentAt: { gte: dayAgo } } }),
    prisma.payout.count({ where: { status: "PENDING" } }),
    prisma.ticketEscrow.count({ where: { state: "IN_ESCROW" } }),
  ]);

  return NextResponse.json({
    ok: true,
    window: "24h",
    metrics: {
      orders: { paid: ordersPaid, delivered: ordersDelivered, completed: ordersCompleted, cancelled: ordersCancelled },
      failedEmails,
      pendingPayouts,
      ticketsInEscrow: escrowIn,
    },
    ts: now.toISOString(),
  });
}
