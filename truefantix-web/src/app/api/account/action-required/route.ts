export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { pendingAdminRequests } from "@/lib/dispute-case";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      select: { seller: { select: { id: true } } },
    });
    if (!user?.seller) {
      return NextResponse.json({ ok: true, total: 0, items: [] });
    }

    const [buyerOrders, sellerOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          buyerSellerId: user.seller.id,
          status: { in: ["PAID", "DELIVERED"] },
        },
        select: {
          id: true,
          status: true,
          transferVerificationStatus: true,
          buyerConfirmationStatus: true,
          transferVerificationReason: true,
        },
      }),
      prisma.order.findMany({
        where: {
          sellerId: user.seller.id,
          status: { in: ["PAID", "DELIVERED"] },
        },
        select: {
          id: true,
          transferProofType: true,
          buyerConfirmationStatus: true,
          transferVerificationReason: true,
        },
      }),
    ]);

    const buyerSupportRequests = buyerOrders.filter(
      (order) =>
        order.buyerConfirmationStatus === "DISPUTED" &&
        pendingAdminRequests(order.transferVerificationReason, "BUYER").length > 0
    ).length;
    const sellerSupportRequests = sellerOrders.filter(
      (order) =>
        order.buyerConfirmationStatus === "DISPUTED" &&
        pendingAdminRequests(order.transferVerificationReason, "SELLER").length > 0
    ).length;
    const buyerConfirmations = buyerOrders.filter(
      (order) =>
        order.status === "PAID" &&
        order.transferVerificationStatus === "PENDING" &&
        order.buyerConfirmationStatus === "PENDING"
    ).length;
    const sellerTransfers = sellerOrders.filter(
      (order) => order.buyerConfirmationStatus !== "DISPUTED" && !order.transferProofType
    ).length;

    const items = [
      ...(buyerSupportRequests
        ? [{
            key: "buyer-support",
            label: `${buyerSupportRequests} support request${buyerSupportRequests === 1 ? "" : "s"} waiting for your reply`,
            detail: "TrueFanTix Support needs information or documents from you as the buyer.",
            href: "/account/tickets/holding",
            count: buyerSupportRequests,
          }]
        : []),
      ...(sellerSupportRequests
        ? [{
            key: "seller-support",
            label: `${sellerSupportRequests} support request${sellerSupportRequests === 1 ? "" : "s"} waiting for your reply`,
            detail: "TrueFanTix Support needs information or documents from you as the seller.",
            href: "/account/tickets/seller-holding",
            count: sellerSupportRequests,
          }]
        : []),
      ...(buyerConfirmations
        ? [{
            key: "buyer-confirmation",
            label: `${buyerConfirmations} ticket order${buyerConfirmations === 1 ? "" : "s"} waiting for receipt confirmation`,
            detail: "Confirm only after the transferred tickets appear in your ticket-provider account.",
            href: "/account/tickets/holding",
            count: buyerConfirmations,
          }]
        : []),
      ...(sellerTransfers
        ? [{
            key: "seller-transfer",
            label: `${sellerTransfers} ticket order${sellerTransfers === 1 ? "" : "s"} waiting for transfer`,
            detail: "Transfer the tickets and submit proof before the deadline.",
            href: "/account/tickets/seller-holding",
            count: sellerTransfers,
          }]
        : []),
    ];

    return NextResponse.json({
      ok: true,
      total: items.reduce((total, item) => total + item.count, 0),
      items,
    });
  } catch (err) {
    console.error("GET /api/account/action-required failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not load required account actions." },
      { status: 500 }
    );
  }
}
