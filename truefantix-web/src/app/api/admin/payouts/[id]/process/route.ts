export const runtime = "nodejs";

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { payoutReadinessError } from "@/lib/payouts/readiness";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

function payoutIdFromRequest(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("payouts");
  return index >= 0 ? decodeURIComponent(parts[index + 1] || "").trim() : "";
}

function orderIdFromProviderRef(providerRef: string | null) {
  return providerRef?.startsWith("order:") ? providerRef.slice("order:".length) : null;
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const payoutId = payoutIdFromRequest(req);
  if (!payoutId) return NextResponse.json({ ok: false, error: "Payout ID is required." }, { status: 400 });

  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { seller: true },
  });
  if (!payout) return NextResponse.json({ ok: false, error: "Payout not found." }, { status: 404 });

  const orderId = orderIdFromProviderRef(payout.providerRef);
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } }) : null;
  const readinessError = payoutReadinessError({ ...payout, order });
  if (readinessError) return NextResponse.json({ ok: false, error: "PAYOUT_NOT_READY", message: readinessError }, { status: 409 });

  if (payout.stripeTransferId) {
    if (payout.status !== "PAID") await prisma.payout.update({ where: { id: payout.id }, data: { status: "PAID", paidAt: payout.paidAt || new Date(), failureReason: null } });
    return NextResponse.json({ ok: true, replay: true, payoutId: payout.id, stripeTransferId: payout.stripeTransferId });
  }

  const staleProcessingBefore = new Date(Date.now() - 5 * 60 * 1000);
  const claimed = await prisma.payout.updateMany({
    where: {
      id: payout.id,
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", lastAttemptAt: { lt: staleProcessingBefore } },
      ],
      stripeTransferId: null,
    },
    data: { status: "PROCESSING", failureReason: null, lastAttemptAt: new Date(), attemptCount: { increment: 1 } },
  });
  if (claimed.count !== 1) return NextResponse.json({ ok: false, error: "PAYOUT_ALREADY_PROCESSING", message: "This payout is already being processed. Refresh before retrying." }, { status: 409 });

  try {
    const stripe = stripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(order!.payment!.providerRef, { expand: ["latest_charge"] });
    const latestCharge = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id;
    if (!latestCharge) throw new Error("The original Stripe charge could not be identified.");

    const transfer = await stripe.transfers.create({
      amount: payout.netCents,
      currency: order!.payment!.currency.toLowerCase(),
      destination: payout.seller.stripeAccountId!,
      source_transaction: latestCharge,
      transfer_group: `ORDER_${order!.id}`,
      metadata: { payoutId: payout.id, orderId: order!.id, sellerId: payout.sellerId },
    }, { idempotencyKey: `truefantix:payout:${payout.id}` });

    const paidAt = new Date();
    await prisma.payout.update({ where: { id: payout.id }, data: {
      status: "PAID", provider: "STRIPE_CONNECT_TRANSFER", stripeTransferId: transfer.id,
      failureReason: null, paidAt,
    } });
    await auditLog({ action: "ADMIN_SETTINGS_UPDATE", userId: gate.user.id, targetType: "Payout", targetId: payout.id, metadata: { action: "PAYOUT_RELEASED", orderId: order!.id, stripeTransferId: transfer.id, amountCents: payout.netCents }, ...createAuditContext(req) });
    return NextResponse.json({ ok: true, payoutId: payout.id, stripeTransferId: transfer.id, status: "PAID", paidAt });
  } catch (error: any) {
    const message = String(error?.message || "Stripe transfer failed.").slice(0, 1000);
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "FAILED", failureReason: message } });
    await auditLog({ action: "ADMIN_SETTINGS_UPDATE", userId: gate.user.id, targetType: "Payout", targetId: payout.id, metadata: { action: "PAYOUT_FAILED", orderId, error: message }, ...createAuditContext(req) });
    return NextResponse.json({ ok: false, error: "PAYOUT_FAILED", message }, { status: 502 });
  }
}
