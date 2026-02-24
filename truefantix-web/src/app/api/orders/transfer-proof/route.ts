export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards"; // requireUser instead of requireSellerApproved for general access

// Utility to normalize string inputs
function normalizeString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s.slice(0, 2048) : null; // Max length for URLs/JSON
}

// POST /api/orders/transfer-proof
// Allows a seller to submit proof of ticket transfer for a specific order.
export async function POST(req: Request) {
  try {
    const gate = await requireUser(); // Ensure user is logged in
    const body = (await req.json().catch(() => null)) as {
      orderId?: string;
      transferProofType?: string;
      transferProofData?: string; // URL to screenshot, or transfer ID text
    } | null;

    if (!body || !body.orderId || !body.transferProofType || !body.transferProofData) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Missing orderId, transferProofType, or transferProofData." },
        { status: 400 }
      );
    }

    const orderId = normalizeString(body.orderId);
    const transferProofType = normalizeString(body.transferProofType);
    const transferProofData = normalizeString(body.transferProofData);

    if (!orderId || !transferProofType || !transferProofData) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Invalid orderId, transferProofType, or transferProofData." },
        { status: 400 }
      );
    }

    // Find the order and verify the logged-in user is the seller
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, sellerId: true, status: true, buyerConfirmationStatus: true },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }

    if (order.sellerId !== gate.user.sellerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "User is not the seller for this order." }, { status: 403 });
    }

    // Only allow submission if order is PAID and buyer hasn't confirmed/disputed yet
    if (order.status !== "PAID" || order.buyerConfirmationStatus !== "PENDING") {
      return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "Order is not in a valid state for transfer proof submission." }, { status: 409 });
    }

    // Update the order with transfer proof and set dispute window
    const disputeWindowEndsAt = new Date();
    disputeWindowEndsAt.setDate(disputeWindowEndsAt.getDate() + 2); // 2-day dispute window (48 hours)

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        transferProofType,
        transferProofData,
        transferVerificationStatus: "PENDING", // Automated verification will update this
        disputeWindowEndsAt,
      },
      select: { id: true, status: true, transferProofType: true, transferVerificationStatus: true, disputeWindowEndsAt: true },
    });

    // TODO: Trigger notification to buyer that transfer proof has been submitted
    // TODO: Trigger automated transfer verification (AI image analysis)

    return NextResponse.json({ ok: true, order: updatedOrder, message: "Transfer proof submitted. Buyer will be notified." }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("POST /api/orders/transfer-proof failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not submit transfer proof." }, { status: 500 });
  }
}
