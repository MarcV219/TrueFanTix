export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { schemas, validateRequest } from "@/lib/validation";

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

    // Get order with items
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticket: true } },
        payment: true,
        seller: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Order not found." },
        { status: 404 }
      );
    }

    // Verify order belongs to current user
    const buyerSellerId = gate.user.sellerId;
    if (order.buyerSellerId !== buyerSellerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "This order does not belong to you." },
        { status: 403 }
      );
    }

    // Check order status
    if (order.status !== "PENDING") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", message: "Order is not available for payment." },
        { status: 400 }
      );
    }

    // Check reservation hasn't expired
    const now = new Date();
    const tickets = order.items.map((item: any) => item.ticket);
    const hasExpiredReservation = tickets.some(
      (ticket: any) =>
        ticket.status === "RESERVED" &&
        ticket.reservedByOrderId === orderId &&
        (!ticket.reservedUntil || ticket.reservedUntil <= now)
    );

    if (hasExpiredReservation) {
      await prisma.$transaction(async (tx: any) => {
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
      });

      return NextResponse.json(
        {
          ok: false,
          error: "RESERVATION_EXPIRED",
          message: "This checkout reservation expired before payment was completed. Please start checkout again.",
        },
        { status: 409 }
      );
    }

    for (const ticket of tickets) {
      if (ticket.status !== "RESERVED" || ticket.reservedByOrderId !== orderId) {
        return NextResponse.json(
          { ok: false, error: "RESERVATION_EXPIRED", message: "Ticket reservation has expired." },
          { status: 409 }
        );
      }
      if (!ticket.reservedUntil || ticket.reservedUntil <= now) {
        return NextResponse.json(
          { ok: false, error: "RESERVATION_EXPIRED", message: "Ticket reservation has expired." },
          { status: 409 }
        );
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
        return NextResponse.json(
          {
            ok: true,
            clientSecret: existingIntent.client_secret,
            amount: order.totalCents,
            currency,
            reused: true,
          },
          { status: 200 }
        );
      }

      if (existingIntent.status === "succeeded") {
        return NextResponse.json(
          {
            ok: false,
            error: "PAYMENT_ALREADY_SUCCEEDED",
            message: "Stripe has already accepted payment for this order. Please wait a moment and refresh your order status.",
          },
          { status: 409 }
        );
      }
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: order.totalCents,
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order.id,
        buyerId: gate.user.id,
        sellerId: order.sellerId,
        currency,
      },
      description: `TrueFanTix Order #${order.id.slice(0, 8)}`,
    });

    await prisma.payment.upsert({
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

    return NextResponse.json(
      {
        ok: true,
        clientSecret: paymentIntent.client_secret,
        amount: order.totalCents,
        currency,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/payments/create-intent error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: err?.message || "Failed to create payment." },
      { status: 500 }
    );
  }
}
