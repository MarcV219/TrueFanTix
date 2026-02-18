export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseOrderIdFromUrl(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const orderId = parseOrderIdFromUrl(req);
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Order ID is required." },
        { status: 400 }
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            ticket: true,
          },
        },
        payment: true,
        seller: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Order not found." },
        { status: 404 }
      );
    }

    // Verify order belongs to current user (as buyer)
    if (order.buyerSellerId !== gate.user.sellerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "You do not have access to this order." },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        order: {
          ...order,
          amount: order.amountCents / 100,
          adminFee: order.adminFeeCents / 100,
          total: order.totalCents / 100,
        },
      },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("GET /api/orders/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
