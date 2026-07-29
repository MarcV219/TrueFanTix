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

async function loadConversationHistory(orderId: string) {
  try {
    return await prisma.conversation.findUnique({
      where: { orderId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender: { select: { id: true, email: true, firstName: true, lastName: true } },
            attachments: true,
          },
        },
      },
    });
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "P2021") {
      console.warn("Admin order review: conversation history table is unavailable; continuing without messages.");
      return null;
    }
    throw err;
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
        seller: { select: { id: true, name: true, user: { select: { email: true, firstName: true, lastName: true } } } },
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

    const [auditLogs, emailDeliveries, ticketEscrows, accessTokenTransactions, payouts, conversation] = await Promise.all([
      prisma.auditLog.findMany({ where: { targetType: "Order", targetId: order.id }, orderBy: { createdAt: "asc" }, take: 500 }),
      prisma.emailDelivery.findMany({ where: { orderId: order.id }, orderBy: { sentAt: "asc" } }),
      prisma.ticketEscrow.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
      prisma.accessTokenTransaction.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
      prisma.payout.findMany({ where: { providerRef: `order:${order.id}` }, orderBy: { createdAt: "asc" } }),
      loadConversationHistory(order.id),
    ]);

    return NextResponse.json({
      ok: true,
      order: {
        ...order,
        caseHistory: {
          orderCreatedAt: order.createdAt,
          payment: order.payment,
          auditLogs: auditLogs.map((log) => ({ ...log, metadata: parseJson(log.metadata) })),
          emailDeliveries,
          ticketEscrows,
          accessTokenTransactions,
          payouts,
          messages: conversation?.messages || [],
        },
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
