export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

function normalizeQuery(value: string | null) {
  return String(value ?? "").trim();
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const q = normalizeQuery(url.searchParams.get("q"));
  const status = normalizeQuery(url.searchParams.get("status")).toUpperCase();
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 25), 1), 50);

  const where: any = {};
  if (status === "DISPUTED") {
    where.buyerConfirmationStatus = "DISPUTED";
  } else if (status === "HUMAN_REVIEW") {
    where.transferVerificationStatus = "MANUAL_REVIEW";
  } else if (status === "RESOLVED_DISPUTES") {
    where.buyerConfirmationStatus = { not: "DISPUTED" };
    where.transferVerificationReason = { contains: "\"type\":\"BUYER_DISPUTE\"" };
  } else if (status) {
    where.status = status;
  }
  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { sellerId: { contains: q, mode: "insensitive" } },
      { buyerSellerId: { contains: q, mode: "insensitive" } },
      { payment: { providerRef: { contains: q, mode: "insensitive" } } },
      { items: { some: { ticket: { title: { contains: q, mode: "insensitive" } } } } },
      { items: { some: { ticket: { venue: { contains: q, mode: "insensitive" } } } } },
      { seller: { name: { contains: q, mode: "insensitive" } } },
      { buyerSeller: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      status: true,
      createdAt: true,
      sellerId: true,
      buyerSellerId: true,
      amountCents: true,
      adminFeeCents: true,
      adminFeeTaxCents: true,
      currency: true,
      taxRateBps: true,
      taxRegionCode: true,
      taxCountryCode: true,
      taxLabel: true,
      totalCents: true,
      transferVerificationStatus: true,
      transferVerificationReason: true,
      buyerConfirmationStatus: true,
      disputeWindowEndsAt: true,
      seller: { select: { id: true, name: true } },
      buyerSeller: { select: { id: true, name: true } },
      payment: {
        select: {
          status: true,
          provider: true,
          providerRef: true,
          amountCents: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          priceCents: true,
          faceValueCents: true,
          currency: true,
          ticket: {
            select: {
              id: true,
              title: true,
              venue: true,
              date: true,
              status: true,
              reservedUntil: true,
              soldAt: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ ok: true, q, status, orders });
}
