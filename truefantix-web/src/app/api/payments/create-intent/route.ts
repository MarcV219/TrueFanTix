export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  }
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
}

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

export async function POST(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    let body: { orderId?: string };
    try {
      body = (await req.json()) as { orderId?: string };
    } catch {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const orderId = normalizeId(body.orderId);
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Order ID is required." },
        { status: 400 }
      );
    }

    // Get order with items
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticket: true } },
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
    const tickets = order.items.map((item) => item.ticket);
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

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: order.totalCents,
      currency: "cad",
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order.id,
        buyerId: gate.user.id,
        sellerId: order.sellerId,
      },
      description: `TrueFanTix Order #${order.id.slice(0, 8)}`,
    });

    return NextResponse.json({
      ok: true,
      clientSecret: paymentIntent.client_secret,
      amount: order.totalCents,
      currency: "cad",
    }, { status: 200 });

  } catch (err: any) {
    console.error("POST /api/payments/create-intent error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: err?.message || "Failed to create payment." },
      { status: 500 }
    );
  }
}
