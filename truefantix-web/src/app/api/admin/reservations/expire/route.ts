export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus } from "@prisma/client";

export async function POST() {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Find expired reserved tickets (cap for MVP safety)
    const expiredTickets = await tx.ticket.findMany({
      where: {
        status: TicketStatus.RESERVED,
        reservedUntil: { lt: now },
        reservedByOrderId: { not: null },
      },
      select: { id: true, reservedByOrderId: true },
      take: 200,
    });

    const orderIds = Array.from(
      new Set(expiredTickets.map((t) => t.reservedByOrderId!).filter(Boolean))
    );

    let ticketsReleased = 0;
    let ordersCancelled = 0;

    for (const orderId of orderIds) {
      // Cancel order if still PENDING
      const cancelled = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED },
      });

      if (cancelled.count === 1) ordersCancelled += 1;

      // Release ALL tickets reserved by this order (that are expired as of now)
      const released = await tx.ticket.updateMany({
        where: {
          status: TicketStatus.RESERVED,
          reservedByOrderId: orderId,
          reservedUntil: { lt: now },
        },
        data: {
          status: TicketStatus.AVAILABLE,
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

  return NextResponse.json({ ok: true, now, ...result });
}
