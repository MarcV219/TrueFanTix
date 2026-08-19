import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { payoutReadinessError } from "@/lib/payouts/readiness";
import { sourceSettlementCurrency, stripeTransferFunding } from "@/lib/payouts/stripeTransfer";
import { instantPayoutDestination } from "@/lib/payouts/instantPayout";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

function orderIdFromProviderRef(providerRef: string | null) {
  return providerRef?.startsWith("order:") ? providerRef.slice("order:".length) : null;
}

export type ProcessPayoutResult =
  | { ok: true; replay?: boolean; payoutId: string; stripeTransferId: string; status: "PAID"; paidAt?: Date; instantPayoutStatus?: string }
  | { ok: false; code: "NOT_FOUND" | "NOT_READY" | "ALREADY_PROCESSING" | "STRIPE_FAILED"; message: string; payoutId: string; orderId?: string | null };

export async function processStripePayout(payoutId: string, options: { actorUserId?: string; automatic?: boolean } = {}): Promise<ProcessPayoutResult> {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, include: { seller: true } });
  if (!payout) return { ok: false, code: "NOT_FOUND", message: "Payout not found.", payoutId };

  const orderId = orderIdFromProviderRef(payout.providerRef);
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } }) : null;

  const attemptInstantPayout = async (stripe: Stripe, stripeTransferId: string) => {
    const fresh = await prisma.payout.findUnique({ where: { id: payout.id } });
    if (fresh?.stripeInstantPayoutId) return fresh.instantPayoutStatus || "SUCCEEDED";

    let destination;
    try {
      const externalAccounts = await stripe.accounts.listExternalAccounts(payout.seller.stripeAccountId!, { limit: 100 });
      destination = instantPayoutDestination(externalAccounts.data as any[], order!.payment!.currency);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : "Could not check Stripe Instant Payout eligibility.").slice(0, 1000);
      await prisma.payout.update({ where: { id: payout.id }, data: { instantPayoutStatus: "FAILED", instantPayoutFailure: message } });
      return "FAILED";
    }
    if (!destination) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { instantPayoutStatus: "STANDARD_ONLY", instantPayoutFailure: null },
      });
      return "STANDARD_ONLY";
    }

    try {
      const instant = await stripe.payouts.create({
        amount: payout.netCents,
        currency: order!.payment!.currency.toLowerCase(),
        method: "instant",
        destination: destination.id,
        metadata: { payoutId: payout.id, orderId: order!.id, stripeTransferId, feePaidBy: "TRUEFANTIX" },
      }, {
        stripeAccount: payout.seller.stripeAccountId!,
        idempotencyKey: `truefantix:instant-payout:${payout.id}`,
      });
      const instantPayoutAt = new Date(instant.created * 1000);
      await prisma.payout.update({
        where: { id: payout.id },
        data: { stripeInstantPayoutId: instant.id, instantPayoutStatus: instant.status.toUpperCase(), instantPayoutAt, instantPayoutFailure: null },
      });
      await auditLog({ action: "PAYOUT_COMPLETE", userId: options.actorUserId, targetType: "Payout", targetId: payout.id, metadata: { action: "INSTANT_PAYOUT_SENT", orderId: order!.id, stripeTransferId, stripeInstantPayoutId: instant.id, amountCents: payout.netCents, currency: order!.payment!.currency.toUpperCase(), feePaidBy: "TRUEFANTIX", automatic: !!options.automatic } });
      return instant.status.toUpperCase();
    } catch (error) {
      const message = String(error instanceof Error ? error.message : "Stripe Instant Payout failed.").slice(0, 1000);
      await prisma.payout.update({ where: { id: payout.id }, data: { instantPayoutStatus: "FAILED", instantPayoutFailure: message } });
      await auditLog({ action: "PAYOUT_FAILED", userId: options.actorUserId, targetType: "Payout", targetId: payout.id, metadata: { action: "INSTANT_PAYOUT_FAILED", orderId: order!.id, stripeTransferId, error: message, automatic: !!options.automatic } });
      return "FAILED";
    }
  };

  if (payout.stripeTransferId) {
    if (payout.status !== "PAID") await prisma.payout.update({ where: { id: payout.id }, data: { status: "PAID", paidAt: payout.paidAt || new Date(), failureReason: null } });
    const instantPayoutStatus = await attemptInstantPayout(stripeClient(), payout.stripeTransferId);
    return { ok: true, replay: true, payoutId: payout.id, stripeTransferId: payout.stripeTransferId, status: "PAID", instantPayoutStatus };
  }

  const readinessError = payoutReadinessError({ ...payout, order });
  if (readinessError) return { ok: false, code: "NOT_READY", message: readinessError, payoutId, orderId };

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
    const instantPayoutStatus = await attemptInstantPayout(stripe, transfer.id);
    return { ok: true, payoutId: payout.id, stripeTransferId: transfer.id, status: "PAID", paidAt, instantPayoutStatus };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : "Stripe transfer failed.").slice(0, 1000);
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "FAILED", failureReason: message } });
    await auditLog({ action: "PAYOUT_FAILED", userId: options.actorUserId, targetType: "Payout", targetId: payout.id, metadata: { orderId, error: message, automatic: !!options.automatic } });
    return { ok: false, code: "STRIPE_FAILED", message, payoutId, orderId };
  }
}
