export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { LegacyPaymentIntentCommand } from "@prisma/client";
import { releaseOrderAccessTokenHolds } from "@/lib/accessTokenHolds";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { schemas, validateRequest } from "@/lib/validation";
import {
  BuyerPurchaseAccessChangedError,
  ManagedAccountPurchaseError,
  runOrdinaryPurchase,
} from "@/lib/tickets/ordinary-buyer";
import { prisma } from "@/lib/prisma";
import {
  assertLegacyPaymentIntentProviderEvidence,
  claimLegacyPaymentIntentCommand,
  finalizeLegacyPaymentIntentCommand,
  LegacyPaymentIntentAuthorizationChangedError,
  type LegacyPaymentIntentProviderEvidence,
  markLegacyPaymentIntentReconciliationRequired,
  stageLegacyPaymentIntentCommand,
} from "@/lib/payments/legacyPaymentIntent";

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  }
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
}

function normalizeCurrency(value: unknown): "CAD" | "USD" {
  return String(value || "CAD").trim().toUpperCase() === "USD" ? "USD" : "CAD";
}

async function replaySucceededPaymentIntent(
  stripe: Awaited<ReturnType<typeof getStripe>>,
  command: LegacyPaymentIntentCommand,
) {
  if (!command.providerIntentId) {
    return NextResponse.json({
      ok: false,
      error: "PAYMENT_RECONCILIATION_REQUIRED",
      message: "The committed payment-intent evidence is incomplete. Reconciliation is required.",
      retrySafe: false,
    }, { status: 409 });
  }

  let rawIntent: {
    id?: string;
    status?: string;
    amount?: number;
    currency?: string;
    client_secret?: string | null;
  };
  try {
    rawIntent = await stripe.paymentIntents.retrieve(command.providerIntentId);
  } catch {
    return NextResponse.json({
      ok: false,
      error: "PAYMENT_PROVIDER_UNAVAILABLE",
      message: "The existing payment intent could not be retrieved. No new payment intent was created.",
      retrySafe: true,
    }, { status: 503 });
  }
  const evidence: LegacyPaymentIntentProviderEvidence = {
    id: typeof rawIntent.id === "string" ? rawIntent.id : "",
    status: typeof rawIntent.status === "string" ? rawIntent.status : "",
    amountCents: Number(rawIntent.amount),
    currency: typeof rawIntent.currency === "string" ? rawIntent.currency : "",
    clientSecret: typeof rawIntent.client_secret === "string" ? rawIntent.client_secret : "",
  };
  try {
    assertLegacyPaymentIntentProviderEvidence(command, evidence);
    if (
      evidence.id !== command.providerIntentId
      || evidence.status !== command.providerStatus
      || evidence.amountCents !== command.providerAmountCents
      || evidence.currency.toUpperCase() !== command.providerCurrency
    ) {
      throw new Error("provider evidence mismatch");
    }
  } catch {
    return NextResponse.json({
      ok: false,
      error: "PAYMENT_RECONCILIATION_REQUIRED",
      message: "The retrieved payment intent did not match the committed provider evidence. No new payment intent was created.",
      retrySafe: false,
    }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    clientSecret: evidence.clientSecret,
    amount: command.expectedAmountCents,
    currency: command.currency,
    reused: true,
  });
}

export async function POST(req: Request) {
  const rlResult = await applyRateLimit(req, "payments:create-intent");
  if (!rlResult.ok) return rlResult.response;

  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const validation = await validateRequest(schemas.paymentsCreateIntent)(req);
    if (!validation.success) return validation.response;

    const { orderId } = validation.data;

    const result = await runOrdinaryPurchase(gate.user.id, async (tx, currentUser) => {
      // Commit an immutable checkout command before provider I/O. The order,
      // every reserved ticket, and the buyer wallet remain behind the same
      // current-identity boundary as checkout.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      await tx.$queryRaw`
        SELECT ticket."id"
        FROM "Ticket" ticket
        INNER JOIN "OrderItem" item ON item."ticketId" = ticket."id"
        WHERE item."orderId" = ${orderId}
        ORDER BY ticket."id"
        FOR UPDATE OF ticket
      `;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { ticket: true } },
          payment: true,
          seller: true,
        },
      });

      if (!order) {
        return {
          status: 404,
          body: { ok: false, error: "NOT_FOUND", message: "Order not found." },
        };
      }

      if (order.buyerSellerId !== currentUser.seller.id) {
        return {
          status: 403,
          body: { ok: false, error: "FORBIDDEN", message: "This order does not belong to you." },
        };
      }

      if (order.status !== "PENDING") {
        return {
          status: 400,
          body: { ok: false, error: "INVALID_STATUS", message: "Order is not available for payment." },
        };
      }

      const now = new Date();
      const tickets = order.items.map((item: any) => item.ticket);
      const hasExpiredReservation = tickets.some(
        (ticket: any) =>
          ticket.status === "RESERVED" &&
          ticket.reservedByOrderId === orderId &&
          (!ticket.reservedUntil || ticket.reservedUntil <= now),
      );

      if (hasExpiredReservation) {
        await tx.order.updateMany({
          where: { id: orderId, status: "PENDING" },
          data: { status: "CANCELLED" },
        });

        await tx.ticket.updateMany({
          where: {
            status: "RESERVED",
            reservedByOrderId: orderId,
          },
          data: {
            status: "AVAILABLE",
            reservedByOrderId: null,
            reservedUntil: null,
          },
        });
        await releaseOrderAccessTokenHolds(tx, orderId);

        return {
          status: 409,
          body: {
            ok: false,
            error: "RESERVATION_EXPIRED",
            message: "This checkout reservation expired before payment was completed. Please start checkout again.",
          },
        };
      }

      for (const ticket of tickets) {
        if (
          ticket.status !== "RESERVED" ||
          ticket.reservedByOrderId !== orderId ||
          !ticket.reservedUntil ||
          ticket.reservedUntil <= now
        ) {
          return {
            status: 409,
            body: {
              ok: false,
              error: "RESERVATION_EXPIRED",
              message: "Ticket reservation has expired.",
            },
          };
        }
      }

      const currency = normalizeCurrency((order as any).currency);
      const priorPayment = order.payment
        ? {
            id: order.payment.id,
            provider: order.payment.provider,
            providerRef: order.payment.providerRef,
            amountCents: order.payment.amountCents,
            currency: order.payment.currency,
          }
        : null;
      const command = await stageLegacyPaymentIntentCommand(tx, {
        orderId: order.id,
        buyerUserId: currentUser.id,
        buyerSellerId: currentUser.seller.id,
        sellerId: order.sellerId,
        expectedAmountCents: order.totalCents,
        currency,
        priorPayment,
        ticketSnapshot: tickets.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          reservedByOrderId: ticket.reservedByOrderId,
          reservedUntil: ticket.reservedUntil?.toISOString() ?? null,
        })),
        authorizedAt: now,
      });
      return { command };
    });

    if ("status" in result) {
      return NextResponse.json(result.body, { status: result.status });
    }

    if (result.command.status === "SUCCEEDED") {
      let replayStripe;
      try {
        replayStripe = await getStripe();
      } catch {
        return NextResponse.json({
          ok: false,
          error: "PAYMENT_PROVIDER_UNAVAILABLE",
          message: "The existing payment intent could not be retrieved. No new payment intent was created.",
          retrySafe: true,
        }, { status: 503 });
      }
      return replaySucceededPaymentIntent(replayStripe, result.command);
    }
    if (result.command.status !== "NOT_SENT") {
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_RECONCILIATION_REQUIRED",
        message: "A payment-intent provider attempt is already recorded for this order. Do not retry automatically; reconciliation is required.",
        retrySafe: false,
      }, { status: 409 });
    }

    let stripe;
    try {
      stripe = await getStripe();
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_PROVIDER_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Payment provider is unavailable.",
        retrySafe: true,
      }, { status: 503 });
    }

    const claimed = await prisma.$transaction(
      (tx) => claimLegacyPaymentIntentCommand(tx, result.command.id),
      { isolationLevel: "Serializable" },
    );
    if (!claimed) {
      const current = await prisma.legacyPaymentIntentCommand.findUnique({ where: { id: result.command.id } });
      if (current?.status === "SUCCEEDED") {
        return replaySucceededPaymentIntent(stripe, current);
      }
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_RECONCILIATION_REQUIRED",
        message: "Another request may already have contacted the payment provider. Do not retry automatically; reconciliation is required.",
        retrySafe: false,
      }, { status: 409 });
    }

    let rawIntent: {
      id?: string;
      status?: string;
      amount?: number;
      currency?: string;
      client_secret?: string | null;
    };
    let reused = false;
    try {
      if (claimed.priorPaymentProvider === "STRIPE" && claimed.priorPaymentRef) {
        rawIntent = await stripe.paymentIntents.retrieve(claimed.priorPaymentRef);
        const retrievedEvidence: LegacyPaymentIntentProviderEvidence = {
          id: typeof rawIntent.id === "string" ? rawIntent.id : "",
          status: typeof rawIntent.status === "string" ? rawIntent.status : "",
          amountCents: Number(rawIntent.amount),
          currency: typeof rawIntent.currency === "string" ? rawIntent.currency : "",
          clientSecret: typeof rawIntent.client_secret === "string" ? rawIntent.client_secret : "",
        };
        try {
          assertLegacyPaymentIntentProviderEvidence(claimed, retrievedEvidence);
          reused = true;
        } catch {
          if (retrievedEvidence.status === "succeeded") {
            await prisma.$transaction((tx) => markLegacyPaymentIntentReconciliationRequired(
              tx,
              claimed.id,
              "EXISTING_PROVIDER_INTENT_ALREADY_SUCCEEDED",
              {
                id: retrievedEvidence.id,
                status: retrievedEvidence.status,
                amountCents: retrievedEvidence.amountCents,
                currency: retrievedEvidence.currency.toUpperCase(),
              },
            ));
            return NextResponse.json({
              ok: false,
              error: "PAYMENT_ALREADY_SUCCEEDED",
              message: "Stripe has already accepted payment for this order. Reconciliation is required before retrying.",
              retrySafe: false,
            }, { status: 409 });
          }
          rawIntent = await stripe.paymentIntents.create({
            amount: claimed.expectedAmountCents,
            currency: claimed.currency.toLowerCase(),
            automatic_payment_methods: { enabled: true },
            metadata: {
              orderId: claimed.orderId,
              buyerId: claimed.buyerUserId,
              sellerId: claimed.sellerId,
              currency: claimed.currency,
              paymentCommandId: claimed.id,
              commandDigest: claimed.commandDigest,
            },
            description: `TrueFanTix Order #${claimed.orderId.slice(0, 8)}`,
          }, { idempotencyKey: claimed.idempotencyKey });
        }
      } else {
        rawIntent = await stripe.paymentIntents.create({
          amount: claimed.expectedAmountCents,
          currency: claimed.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: {
            orderId: claimed.orderId,
            buyerId: claimed.buyerUserId,
            sellerId: claimed.sellerId,
            currency: claimed.currency,
            paymentCommandId: claimed.id,
            commandDigest: claimed.commandDigest,
          },
          description: `TrueFanTix Order #${claimed.orderId.slice(0, 8)}`,
        }, { idempotencyKey: claimed.idempotencyKey });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown provider outcome";
      await prisma.$transaction((tx) => markLegacyPaymentIntentReconciliationRequired(
        tx,
        claimed.id,
        `PROVIDER_OUTCOME_UNKNOWN: ${reason}`,
      ));
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_RECONCILIATION_REQUIRED",
        message: "The provider outcome is unknown. Do not retry automatically; reconciliation is required.",
        retrySafe: false,
      }, { status: 409 });
    }

    const evidence: LegacyPaymentIntentProviderEvidence = {
      id: typeof rawIntent.id === "string" ? rawIntent.id : "",
      status: typeof rawIntent.status === "string" ? rawIntent.status : "",
      amountCents: Number(rawIntent.amount),
      currency: typeof rawIntent.currency === "string" ? rawIntent.currency : "",
      clientSecret: typeof rawIntent.client_secret === "string" ? rawIntent.client_secret : "",
    };
    try {
      assertLegacyPaymentIntentProviderEvidence(claimed, evidence);
    } catch {
      await prisma.$transaction((tx) => markLegacyPaymentIntentReconciliationRequired(
        tx,
        claimed.id,
        "PROVIDER_EVIDENCE_MISMATCH_OR_NONREUSABLE_STATUS",
        evidence.id && evidence.status && Number.isFinite(evidence.amountCents) && evidence.currency
          ? { ...evidence, currency: evidence.currency.toUpperCase() }
          : undefined,
      ));
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_RECONCILIATION_REQUIRED",
        message: "The provider response did not match the committed payment command. Do not retry automatically; reconciliation is required.",
        retrySafe: false,
      }, { status: 409 });
    }

    try {
      await runOrdinaryPurchase(gate.user.id, (tx) => finalizeLegacyPaymentIntentCommand(tx, {
        commandId: claimed.id,
        buyerUserId: claimed.buyerUserId,
        evidence,
      }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown local finalization failure";
      await prisma.$transaction((tx) => markLegacyPaymentIntentReconciliationRequired(
        tx,
        claimed.id,
        `PROVIDER_SUCCEEDED_LOCAL_FINALIZE_FAILED: ${reason}`,
        { ...evidence, currency: evidence.currency.toUpperCase() },
      ));
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_RECONCILIATION_REQUIRED",
        message: "The provider accepted the payment command but local finalization did not commit. Do not retry automatically; reconciliation is required.",
        retrySafe: false,
      }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      clientSecret: evidence.clientSecret,
      amount: claimed.expectedAmountCents,
      currency: claimed.currency,
      ...(reused ? { reused: true } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof LegacyPaymentIntentAuthorizationChangedError) {
      return NextResponse.json({
        ok: false,
        error: "PAYMENT_AUTHORIZATION_CHANGED",
        message: err.message,
        retrySafe: false,
      }, { status: 409 });
    }
    if (err instanceof ManagedAccountPurchaseError) {
      return NextResponse.json(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (err instanceof BuyerPurchaseAccessChangedError) {
      const responses = {
        NOT_AUTHENTICATED: [401, "Please log in."],
        BANNED: [403, "This account is restricted."],
        NOT_VERIFIED: [403, "Please verify your email and phone number."],
        BUYING_DISABLED: [403, "Buying is disabled for this account."],
        BUYER_WALLET_MISSING: [409, "Buyer wallet is not set up for this account."],
      } as const;
      const [status, message] = responses[err.code];
      return NextResponse.json({ ok: false, error: err.code, message }, { status });
    }

    const message = err instanceof Error ? err.message : "Failed to create payment.";
    console.error("POST /api/payments/create-intent error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message },
      { status: 500 }
    );
  }
}
