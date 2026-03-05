export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasInternalCronAuth, requireAdmin } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { auditLog, createAuditContext } from "@/lib/audit";

export async function POST(req: Request) {
  const isCron = hasInternalCronAuth(req);
  if (!isCron) {
    const adminGate = await requireAdmin(req);
    if (!adminGate.ok) {
      await auditLog({
        action: "ADMIN_ORDER_ACTION",
        targetType: "Reservation",
        metadata: { operation: "EXPIRE", outcome: "DENY", status: adminGate.res.status },
        ...createAuditContext(req),
      });
      return adminGate.res;
    }

    const rlResult = await applyRateLimit(req, "admin:reservation-expire");
    if (!rlResult.ok) return rlResult.response;
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx: any) => {
    const expiredTickets = await tx.ticket.findMany({
      where: {
        status: "RESERVED",
        reservedUntil: { lt: now },
        reservedByOrderId: { not: null },
      },
      select: { id: true, reservedByOrderId: true },
      take: 200,
    });

    const orderIds: string[] = Array.from(
      new Set(expiredTickets.map((t: any) => t.reservedByOrderId!).filter(Boolean))
    ) as string[];

    let ticketsReleased = 0;
    let ordersCancelled = 0;

    for (const orderId of orderIds) {
      const cancelled = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      if (cancelled.count === 1) ordersCancelled += 1;

      const released = await tx.ticket.updateMany({
        where: {
          status: "RESERVED",
          reservedByOrderId: orderId,
          reservedUntil: { lt: now },
        },
        data: {
          status: "AVAILABLE",
          reservedByOrderId: null,
          reservedUntil: null,
        },
      });

      ticketsReleased += released.count;
    }

    return {
      scanned: expiredTickets.length,
      affectedOrders: orderIds.length,
      ticketsReleased,
      ordersCancelled,
      orderIds,
    };
  });

  await auditLog({
    action: "ADMIN_ORDER_ACTION",
    targetType: "Reservation",
    metadata: {
      operation: "EXPIRE",
      actor: isCron ? "cron" : "admin",
      ...result,
    },
    ...createAuditContext(req),
  });

  return NextResponse.json({ ok: true, now, ...result });
}
