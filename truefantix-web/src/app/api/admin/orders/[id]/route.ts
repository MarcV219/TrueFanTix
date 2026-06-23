export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

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

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const adminGate = await requireAdmin(req);
    if (!adminGate.ok) return adminGate.res;

    const orderId = parseOrderIdFromUrl(req);

    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Missing order id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        sellerId: true,
        buyerSellerId: true,
        amountCents: true,
        adminFeeCents: true,
        adminFeeTaxCents: true,
        taxRateBps: true,
        taxRegionCode: true,
        taxRegionName: true,
        taxCountryCode: true,
        taxLabel: true,
        currency: true,
        totalCents: true,
        transferProofType: true,
        transferProofData: true,
        transferVerificationStatus: true,
        transferVerificationReason: true,
        buyerConfirmationStatus: true,
        buyerConfirmationAt: true,
        disputeWindowEndsAt: true,
        seller: { select: { id: true, name: true } },
        buyerSeller: { select: { id: true, name: true, user: { select: { email: true, firstName: true, lastName: true } } } },
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
            ticketId: true,
            createdAt: true,
            priceCents: true,
            faceValueCents: true,
            currency: true,
            ticket: {
              select: {
                id: true,
                title: true,
                venue: true,
                date: true,
                row: true,
                seat: true,
                priceCents: true,
                faceValueCents: true,
                adminFeePaidCents: true,
                currency: true,
                status: true,
                reservedByOrderId: true,
                reservedUntil: true,
                soldAt: true,
                withdrawnAt: true,
                verificationImage: true,
                verificationStatus: true,
                verificationScore: true,
                verificationReason: true,
                verificationProvider: true,
                verificationEvidence: true,
                eventId: true,
                event: {
                  select: {
                    id: true,
                    title: true,
                    date: true,
                    selloutStatus: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      order: {
        ...order,
        items: order.items.map((item: any) => {
          const parsedEvidence = parseJson(item.ticket?.verificationEvidence ?? null);
          return {
            ...item,
            ticket: item.ticket
              ? {
                  ...item.ticket,
                  parsedEvidence,
                  receiptReview: parsedEvidence?.receiptProof ?? null,
                  officialPricingSync: parsedEvidence?.officialPricingSync ?? null,
                }
              : item.ticket,
          };
        }),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Order lookup failed", details: message },
      { status: 500 }
    );
  }
}
