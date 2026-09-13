export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { releaseOrderAccessTokenHolds } from "@/lib/accessTokenHolds";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { schemas, validateRequest } from "@/lib/validation";
import {
  BuyerPurchaseAccessChangedError,
  ManagedAccountPurchaseError,
  runOrdinaryPurchase,
} from "@/lib/tickets/ordinary-buyer";

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

function isReusablePaymentIntentStatus(status: string) {
  return ["requires_payment_method", "requires_confirmation", "requires_action", "processing"].includes(status);
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
      // Keep order ownership, reservation cleanup, provider activity, and the
      // payment record behind the same current-identity lock as checkout.
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

      const stripe = await getStripe();
      const currency = normalizeCurrency((order as any).currency);

      if (order.payment?.provider === "STRIPE" && order.payment.providerRef) {
        const existingIntent = await stripe.paymentIntents.retrieve(order.payment.providerRef);
        if (
          existingIntent.amount === order.totalCents &&
          existingIntent.currency.toUpperCase() === currency &&
          isReusablePaymentIntentStatus(existingIntent.status) &&
          existingIntent.client_secret
        ) {
          return {
            status: 200,
            body: {
              ok: true,
              clientSecret: existingIntent.client_secret,
              amount: order.totalCents,
              currency,
              reused: true,
            },
          };
        }

        if (existingIntent.status === "succeeded") {
          return {
            status: 409,
            body: {
              ok: false,
              error: "PAYMENT_ALREADY_SUCCEEDED",
              message: "Stripe has already accepted payment for this order. Please wait a moment and refresh your order status.",
            },
          };
        }
      }

      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: order.totalCents,
          currency: currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: {
            orderId: order.id,
            buyerId: currentUser.id,
            sellerId: order.sellerId,
            currency,
          },
          description: `TrueFanTix Order #${order.id.slice(0, 8)}`,
        },
        { idempotencyKey: `truefantix-order-${order.id}` },
      );

      await tx.payment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          amountCents: paymentIntent.amount,
          currency,
          status: "REQUIRES_PAYMENT",
          provider: "STRIPE",
          providerRef: paymentIntent.id,
        },
        update: {
          amountCents: paymentIntent.amount,
          currency,
          status: "REQUIRES_PAYMENT",
          provider: "STRIPE",
          providerRef: paymentIntent.id,
        },
      });

      return {
        status: 200,
        body: {
          ok: true,
          clientSecret: paymentIntent.client_secret,
          amount: order.totalCents,
          currency,
        },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
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
