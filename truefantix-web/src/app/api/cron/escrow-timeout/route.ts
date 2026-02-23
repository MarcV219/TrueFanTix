export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus, PaymentStatus } from "@prisma/client";
import { hasInternalCronAuth } from "@/lib/auth/guards";

const ESCROW_TIMEOUT_MINUTES = 60; // 1 hour for MVP

export async function POST(req: Request) {
  // Allow cron or admin to trigger
  const internalCron = hasInternalCronAuth(req);
  if (!internalCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - ESCROW_TIMEOUT_MINUTES * 60_000);

  const expiredOrders = await prisma.order.findMany({
    where: {
      status: OrderStatus.PAID,
      createdAt: { lt: cutoff },
      payment: { status: PaymentStatus.SUCCEEDED },
    },
    include: {
      items: { select: { ticketId: true } },
      payment: true,
    },
  });

  const results: { orderId: string; ticketIds: string[] }[] = [];

  for (const order of expiredOrders) {
    await prisma.$transaction(async (tx) => {
      // Release tickets back to available
      for (const item of order.items) {
        await tx.ticket.update({
          where: { id: item.ticketId },
          data: {
            status: TicketStatus.AVAILABLE,
            reservedByOrderId: null,
            reservedUntil: null,
          },
        });

        // Mark escrow as released back to seller (if exists)
        await tx.ticketEscrow.upsert({
          where: { ticketId: item.ticketId },
          create: {
            ticketId: item.ticketId,
            orderId: order.id,
            state: "RELEASED_BACK_TO_SELLER",
            releasedAt: new Date(),
            releasedTo: "SELLER",
            failureReason: "Escrow timeout - order expired",
          },
          update: {
            state: "RELEASED_BACK_TO_SELLER",
            releasedAt: new Date(),
            releasedTo: "SELLER",
            failureReason: "Escrow timeout - order expired",
          },
        });
      }

      // Mark order as cancelled
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED },
      });

      // Note: In production, you'd also trigger a Stripe refund here
      // await refundPayment(order.payment?.providerRef);
    });

    results.push({
      orderId: order.id,
      ticketIds: order.items.map((i) => i.ticketId),
    });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    orders: results,
    timeoutMinutes: ESCROW_TIMEOUT_MINUTES,
  });
}
