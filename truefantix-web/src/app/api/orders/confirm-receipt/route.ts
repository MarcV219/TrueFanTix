export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";

// POST /api/orders/confirm-receipt
// Allows a buyer to confirm receipt of tickets for a specific order.
export async function POST(req: Request) {
  try {
    const gate = await requireUser(); // Ensure user is logged in
    const body = (await req.json().catch(() => null)) as {
      orderId?: string;
    } | null;

    if (!body || !body.orderId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Missing orderId." },
        { status: 400 }
      );
    }

    const orderId = String(body.orderId).trim();

    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Invalid orderId." },
        { status: 400 }
      );
    }

    // Find the order and verify the logged-in user is the buyer
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, buyerSellerId: true, status: true, transferVerificationStatus: true, buyerConfirmationStatus: true },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }

    if (order.buyerSellerId !== gate.user.sellerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "User is not the buyer for this order." }, { status: 403 });
    }

    // Only allow confirmation if order is PAID and transfer proof has been submitted by seller
    if (order.status !== "PAID" || order.transferVerificationStatus !== "PENDING") {
      return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "Order is not in a valid state for receipt confirmation." }, { status: 409 });
    }

    // Update the order to confirmed status and record confirmation time
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        buyerConfirmationStatus: "CONFIRMED",
        buyerConfirmationAt: new Date(),
        status: "DELIVERED", // Progress order to DELIVERED status
      },
      select: { id: true, status: true, buyerConfirmationStatus: true, buyerConfirmationAt: true },
    });

    // TODO: Trigger release of funds to seller (Step 6)
    // TODO: Trigger notification to seller that buyer has confirmed receipt

    return NextResponse.json({ ok: true, order: updatedOrder, message: "Ticket receipt confirmed. Funds will be released to seller." }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("POST /api/orders/confirm-receipt failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not confirm receipt." }, { status: 500 });
  }
}
