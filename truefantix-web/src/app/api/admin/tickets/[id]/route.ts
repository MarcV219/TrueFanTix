export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

function parseTicketId(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("tickets");
  return index >= 0 && parts[index + 1] ? decodeURIComponent(parts[index + 1]) : "";
}

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const ticketId = parseTicketId(req);
  if (!ticketId) return NextResponse.json({ ok: false, error: "MISSING_TICKET_ID" }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      title: true,
      image: true,
      venue: true,
      date: true,
      row: true,
      seat: true,
      priceCents: true,
      faceValueCents: true,
      adminFeePaidCents: true,
      currency: true,
      status: true,
      reservedUntil: true,
      reservedByOrderId: true,
      soldAt: true,
      withdrawnAt: true,
      primaryVendor: true,
      transferMethod: true,
      barcodeHash: true,
      barcodeText: true,
      verificationImage: true,
      verificationStatus: true,
      verificationScore: true,
      verificationReason: true,
      verificationProvider: true,
      verificationEvidence: true,
      verifiedAt: true,
      viewCount: true,
      lastViewedAt: true,
      createdAt: true,
      updatedAt: true,
      event: { select: { id: true, title: true, venue: true, date: true, selloutStatus: true } },
      seller: {
        select: {
          id: true,
          name: true,
          rating: true,
          reviews: true,
          status: true,
          accessTokenBalance: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              canBuy: true,
              canSell: true,
              isBanned: true,
            },
          },
        },
      },
      orderItems: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          priceCents: true,
          faceValueCents: true,
          currency: true,
          order: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              amountCents: true,
              adminFeeCents: true,
              adminFeeTaxCents: true,
              totalCents: true,
              currency: true,
              sellerId: true,
              buyerSellerId: true,
              payment: { select: { status: true, provider: true, providerRef: true, amountCents: true, currency: true } },
              buyerSeller: { select: { id: true, name: true, user: { select: { email: true, firstName: true, lastName: true } } } },
            },
          },
        },
      },
      accessTokenTransactions: {
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          type: true,
          source: true,
          amountAccessTokens: true,
          balanceAfterAccessTokens: true,
          note: true,
          referenceType: true,
          referenceId: true,
          orderId: true,
          createdAt: true,
        },
      },
    },
  });

  if (!ticket) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

  const parsedEvidence = parseJson(ticket.verificationEvidence);
  return NextResponse.json({
    ok: true,
    ticket: {
      ...ticket,
      parsedEvidence,
      receiptReview: parsedEvidence?.receiptProof ?? null,
      officialPricingSync: parsedEvidence?.officialPricingSync ?? null,
    },
  });
}
