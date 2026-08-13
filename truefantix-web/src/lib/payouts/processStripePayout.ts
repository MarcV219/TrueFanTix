import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { payoutReadinessError } from "@/lib/payouts/readiness";
import { sourceSettlementCurrency, stripeTransferFunding } from "@/lib/payouts/stripeTransfer";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

function orderIdFromProviderRef(providerRef: string | null) {
  return providerRef?.startsWith("order:") ? providerRef.slice("order:".length) : null;
}

export type ProcessPayoutResult =
  | { ok: true; replay?: boolean; payoutId: string; stripeTransferId: string; status: "PAID"; paidAt?: Date }
  | { ok: false; code: "NOT_FOUND" | "NOT_READY" | "ALREADY_PROCESSING" | "STRIPE_FAILED"; message: string; payoutId: string; orderId?: string | null };

export async function processStripePayout(payoutId: string, options: { actorUserId?: string; automatic?: boolean } = {}): Promise<ProcessPayoutResult> {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, include: { seller: true } });
  if (!payout) return { ok: false, code: "NOT_FOUND", message: "Payout not found.", payoutId };

  const orderId = orderIdFromProviderRef(payout.providerRef);
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } }) : null;
  const readinessError = payoutReadinessError({ ...payout, order });
  if (readinessError) return { ok: false, code: "NOT_READY", message: readinessError, payoutId, orderId };

  if (payout.stripeTransferId) {
    if (payout.status !== "PAID") await prisma.payout.update({ where: { id: payout.id }, data: { status: "PAID", paidAt: payout.paidAt || new Date(), failureReason: null } });
    return { ok: true, replay: true, payoutId: payout.id, stripeTransferId: payout.stripeTransferId, status: "PAID" };
  }

  const staleProcessingBefore = new Date(Date.now() - 5 * 60 * 1000);
  const claimed = await prisma.payout.updateMany({
    where: { id: payout.id, OR: [{ status: { in: ["PENDING", "FAILED"] } }, { status: "PROCESSING", lastAttemptAt: { lt: staleProcessingBefore } }], stripeTransferId: null },
    data: { status: "PROCESSING", failureReason: null, lastAttemptAt: new Date(), attemptCount: { increment: 1 } },
  });
  if (claimed.count !== 1) return { ok: false, code: "ALREADY_PROCESSING", message: "This payout is already being processed.", payoutId, orderId };

  try {
    const stripe = stripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(order!.payment!.providerRef, { expand: ["latest_charge.balance_transaction"] });
    const latestCharge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
    if (!latestCharge) throw new Error("The original Stripe charge could not be identified.");
    const payoutCurrency = order!.payment!.currency.toLowerCase();
    if (paymentIntent.currency !== payoutCurrency || latestCharge.currency !== payoutCurrency) throw new Error(`Currency reconciliation required: the order is ${payoutCurrency.toUpperCase()}, but Stripe charged ${latestCharge.currency.toUpperCase()}. No payout was sent.`);
    const funding = stripeTransferFunding(latestCharge, payoutCurrency, payout.netCents);
    const settlementCurrency = sourceSettlementCurrency(latestCharge);
    const transfer = await stripe.transfers.create({
      amount: funding.amount, currency: funding.currency, destination: payout.seller.stripeAccountId!, source_transaction: funding.source_transaction,
      transfer_group: `ORDER_${order!.id}`,
      metadata: { payoutId: payout.id, orderId: order!.id, sellerId: payout.sellerId, fundingMode: funding.fundingMode, obligationAmount: String(payout.netCents), obligationCurrency: payoutCurrency },
    }, { idempotencyKey: `truefantix:payout:${payout.id}` });

    const paidAt = new Date();
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "PAID", provider: "STRIPE_CONNECT_TRANSFER", stripeTransferId: transfer.id, failureReason: null, paidAt } });
    await auditLog({ action: "PAYOUT_COMPLETE", userId: options.actorUserId, targetType: "Payout", targetId: payout.id, metadata: { action: "PAYOUT_RELEASED", orderId: order!.id, stripeTransferId: transfer.id, amountCents: payout.netCents, payoutCurrency: payoutCurrency.toUpperCase(), stripeTransferAmount: funding.amount, stripeTransferCurrency: funding.currency.toUpperCase(), sourceSettlementCurrency: settlementCurrency?.toUpperCase() || null, fundingMode: funding.fundingMode, automatic: !!options.automatic } });
    return { ok: true, payoutId: payout.id, stripeTransferId: transfer.id, status: "PAID", paidAt };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : "Stripe transfer failed.").slice(0, 1000);
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "FAILED", failureReason: message } });
    await auditLog({ action: "PAYOUT_FAILED", userId: options.actorUserId, targetType: "Payout", targetId: payout.id, metadata: { orderId, error: message, automatic: !!options.automatic } });
    return { ok: false, code: "STRIPE_FAILED", message, payoutId, orderId };
  }
}
