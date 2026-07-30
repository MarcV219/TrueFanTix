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
import { analyzeTransferProof, transferProofIssueMessage } from "@/lib/orders/transferProofReview";

// POST /api/orders/transfer-proof
// Allows a seller to submit proof of ticket transfer for a specific order.
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req); // Ensure user is logged in
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderTransferProof)(req);
    if (!validation.success) return validation.response;

    const { orderId, transferProofType, transferProofData, transferProofImage, transferProofFileName } = validation.data;

    // Find the order and verify the logged-in user is the seller
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        buyerConfirmationStatus: true,
        items: {
          select: {
            id: true,
            ticket: {
              select: {
                title: true,
                venue: true,
                date: true,
                section: true,
                row: true,
                seat: true,
              },
            },
          },
        },
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

    if (!transferProofImage) {
      return NextResponse.json(
        {
          ok: false,
          error: "TRANSFER_PROOF_UPLOAD_REQUIRED",
          message: "Upload a screenshot, image, or PDF confirmation so TrueFanTix can check the transfer proof.",
        },
        { status: 400 }
      );
    }

    const firstTicket = order.items[0]?.ticket ?? null;
    const review = await analyzeTransferProof({
      proofDataUrl: transferProofImage,
      proofFileName: transferProofFileName,
      expectedBuyerName: [
        order.buyerSeller.user?.firstName,
        order.buyerSeller.user?.lastName,
      ].filter(Boolean).join(" ") || null,
      expectedBuyerEmail: order.buyerSeller.user?.email ?? null,
      expectedEventTitles: Array.from(new Set(order.items.map((item) => item.ticket.title).filter(Boolean))),
      expectedVenue: firstTicket?.venue ?? null,
      expectedEventDate: firstTicket?.date ?? null,
      expectedTicketCount: order.items.length,
      expectedTicketDetails: order.items.map((item) =>
        [
          item.ticket.section ? `Section ${item.ticket.section}` : null,
          item.ticket.row ? `Row ${item.ticket.row}` : null,
          item.ticket.seat ? `Seat ${item.ticket.seat}` : null,
        ].filter(Boolean).join(", ") || "General admission"
      ),
      sellerNote: transferProofData ?? null,
    });

    if (review.status === "unsupported") {
      return NextResponse.json(
        {
          ok: false,
          error: "UNSUPPORTED_TRANSFER_PROOF",
          message: "Upload a JPG, PNG, WebP, GIF, or PDF transfer confirmation.",
          review,
        },
        { status: 400 }
      );
    }

    if (review.status === "unavailable") {
      return NextResponse.json(
        {
          ok: false,
          error: "TRANSFER_PROOF_REVIEW_UNAVAILABLE",
          message: "Automated transfer proof review is unavailable. Please try again shortly.",
          review,
        },
        { status: 503 }
      );
    }

    if (!review.ok) {
      const details = review.issues.map(transferProofIssueMessage);
      return NextResponse.json(
        {
          ok: false,
          error: "TRANSFER_PROOF_MISMATCH",
          message: details.length
            ? `This proof could not be accepted because ${details.join("; ")}.`
            : "This proof could not be verified automatically. Upload clearer proof from the ticket platform.",
          review,
        },
        { status: 422 }
      );
    }

    // Update the order with transfer proof and set dispute window
    const submittedAt = new Date();
    const disputeWindowEndsAt = addHours(submittedAt, BUYER_CONFIRMATION_DEADLINE_HOURS);
    const storedProofData = JSON.stringify({
      sellerNote: transferProofData ?? "",
      fileName: transferProofFileName ?? null,
      proofUpload: transferProofImage,
      review,
      reviewedAt: submittedAt.toISOString(),
    });

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        transferProofType,
        transferProofData: storedProofData,
        transferVerificationStatus: "PENDING",
        transferVerificationReason: JSON.stringify({
          status: review.status,
          provider: review.provider,
          model: review.model,
          confidence: review.confidence,
          issues: review.issues,
          reason: review.reason,
        }),
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
        sendEmail: true,
        now: submittedAt,
      });
    }
    return NextResponse.json(
      {
        ok: true,
        order: updatedOrder,
        review,
        message: "Transfer proof checked and accepted. Buyer will be notified.",
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
