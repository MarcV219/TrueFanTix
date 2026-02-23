export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      include: { seller: true },
    });

    if (!user?.seller) {
      return NextResponse.json({ ok: true, sales: [] }, { status: 200 });
    }

    const orders = await prisma.order.findMany({
      where: {
        sellerId: user.seller.id,
        status: { in: ["PAID", "DELIVERED", "COMPLETED"] },
      },
      include: {
        items: {
          include: {
            ticket: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const sales = orders.flatMap((order: any) =>
      order.items.map((item: any) => ({
        id: item.id,
        orderId: order.id,
        orderStatus: order.status,
        createdAt: order.createdAt.toISOString(),
        ticketId: item.ticketId,
        ticketTitle: item.ticket?.title ?? "Ticket",
        venue: item.ticket?.venue ?? "",
        date: item.ticket?.date ?? "",
        amount: item.priceCents / 100,
        adminFee: order.adminFeeCents / 100,
        total: (item.priceCents + order.adminFeeCents) / 100,
      }))
    );

    return NextResponse.json({ ok: true, sales }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/account/transactions/sales error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load sales." },
      { status: 500 }
    );
  }
}
