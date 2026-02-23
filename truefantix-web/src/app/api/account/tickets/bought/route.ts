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
      include: {
        seller: true,
      },
    });

    if (!user?.seller) {
      return NextResponse.json({ ok: true, tickets: [] }, { status: 200 });
    }

    // Get all orders for this buyer with their items and tickets
    const orders = await prisma.order.findMany({
      where: {
        buyerSellerId: user.seller.id,
        status: {
          in: ["PAID", "DELIVERED", "COMPLETED"],
        },
      },
      include: {
        items: {
          include: {
            ticket: {
              include: {
                event: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Flatten tickets from all orders
    const tickets = orders.flatMap((order: any) =>
      order.items.map((item: any) => ({
        id: item.ticket.id,
        title: item.ticket.title,
        venue: item.ticket.venue,
        date: item.ticket.date,
        price: item.priceCents / 100,
        image: item.ticket.image,
        status: item.ticket.status,
        orderId: order.id,
        orderDate: order.createdAt.toISOString(),
        qrCodeUrl: `/api/tickets/${item.ticket.id}/qr`,
      }))
    );

    return NextResponse.json({ ok: true, tickets }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/account/tickets/bought error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load tickets." },
      { status: 500 }
    );
  }
}
