export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards"; // requireUser instead of requireSellerApproved for general access
import { schemas, validateRequest } from "@/lib/validation";
import {
  BUYER_CONFIRMATION_DEADLINE_HOURS,
  addHours,
  notifyBuyerTransferConfirmationRequired,
} from "@/lib/orders/transferWorkflow";

// POST /api/orders/transfer-proof
// Allows a seller to submit proof of ticket transfer for a specific order.
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req); // Ensure user is logged in

    const validation = await validateRequest(schemas.orderTransferProof)(req);
    if (!validation.success) return validation.response;

    const { orderId, transferProofType, transferProofData } = validation.data;

    // Ensure user is authenticated
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }

    // Find the order and verify the logged-in user is the seller
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        buyerConfirmationStatus: true,
        items: { select: { id: true } },
        buyerSeller: { include: { user: true } },
      },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Order not found." },
        { status: 404 }
      );
    }

    if (order.sellerId !== gate.user.sellerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "User is not the seller for this order." },
        { status: 403 }
      );
    }

    // Only allow submission if order is PAID and buyer hasn't confirmed/disputed yet
    if (order.status !== "PAID" || order.buyerConfirmationStatus !== "PENDING") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATE",
          message: "Order is not in a valid state for transfer proof submission.",
        },
        { status: 409 }
      );
    }

    // Update the order with transfer proof and set dispute window
    const submittedAt = new Date();
    const disputeWindowEndsAt = addHours(submittedAt, BUYER_CONFIRMATION_DEADLINE_HOURS);

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        transferProofType,
        transferProofData,
        transferVerificationStatus: "PENDING", // Automated verification will update this
        disputeWindowEndsAt,
      },
      select: {
        id: true,
        status: true,
        transferProofType: true,
        transferVerificationStatus: true,
        disputeWindowEndsAt: true,
      },
    });

    if (order.buyerSeller.user?.id) {
      await notifyBuyerTransferConfirmationRequired({
        buyerUserId: order.buyerSeller.user.id,
        orderId,
        ticketCount: order.items.length,
        deadline: disputeWindowEndsAt,
        now: submittedAt,
      });
    }
    // TODO: Trigger automated transfer verification (AI image analysis)

    return NextResponse.json(
      {
        ok: true,
        order: updatedOrder,
        message: "Transfer proof submitted. Buyer will be notified.",
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }
    console.error("POST /api/orders/transfer-proof failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not submit transfer proof." },
      { status: 500 }
    );
  }
}
