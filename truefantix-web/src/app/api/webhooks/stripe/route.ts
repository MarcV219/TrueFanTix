export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { sendEmail, generatePurchaseConfirmationEmail, generateSaleNotificationEmail } from "@/lib/email";

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  }
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
}

// Verify webhook signature
async function verifySignature(payload: string, signature: string, secret: string) {
  const stripe = await getStripe();
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return { success: true, event };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json(
      { ok: false, error: "CONFIG_ERROR" },
      { status: 500 }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { ok: false, error: "MISSING_SIGNATURE" },
      { status: 400 }
    );
  }

  const payload = await req.text();
  const verification = await verifySignature(payload, signature, webhookSecret);

  if (!verification.success) {
    console.error("Webhook signature verification failed:", verification.error);
    return NextResponse.json(
      { ok: false, error: "INVALID_SIGNATURE" },
      { status: 400 }
    );
  }

  const event = verification.event;

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (!orderId) {
          console.error("No orderId in payment intent metadata");
          break;
        }

        // Update order and payment status
        const updatedOrder = await prisma.$transaction(async (tx) => {
          // Create or update payment record
          await tx.payment.upsert({
            where: { orderId },
            create: {
              orderId,
              amountCents: paymentIntent.amount,
              currency: paymentIntent.currency.toUpperCase(),
              status: PaymentStatus.SUCCEEDED,
              provider: "STRIPE",
              providerRef: paymentIntent.id,
            },
            update: {
              status: PaymentStatus.SUCCEEDED,
              providerRef: paymentIntent.id,
            },
          });

          // Escrow hold: payment succeeded means funds are held.
          // Keep delivery finalization separate (admin deliver route).
          const order = await tx.order.update({
            where: { id: orderId },
            data: { status: OrderStatus.PAID },
            include: {
              items: {
                include: {
                  ticket: true,
                },
              },
              buyerSeller: {
                include: {
                  user: true,
                },
              },
              seller: {
                include: {
                  user: true,
                },
              },
            },
          });

          return order;
        });

        // Send confirmation email to buyer
        if (updatedOrder.buyerSeller?.user) {
          const buyer = updatedOrder.buyerSeller.user;
          const tickets = updatedOrder.items.map(item => ({
            title: item.ticket?.title || "Ticket",
            venue: item.ticket?.venue || "",
            date: item.ticket?.date || "",
          }));
          const total = (updatedOrder.totalCents / 100).toFixed(2);

          const emailContent = generatePurchaseConfirmationEmail(
            updatedOrder.id,
            buyer.firstName,
            tickets,
            total
          );

          await sendEmail({
            to: buyer.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          });
        }

        // Send notification email to seller
        if (updatedOrder.seller?.user && updatedOrder.items.length > 0) {
          const seller = updatedOrder.seller.user;
          const firstTicket = updatedOrder.items[0].ticket;
          const amount = (updatedOrder.amountCents / 100).toFixed(2);

          const emailContent = generateSaleNotificationEmail(
            updatedOrder.id,
            seller.firstName,
            firstTicket?.title || "Ticket",
            amount
          );

          await sendEmail({
            to: seller.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          });
        }

        console.log(`[STRIPE WEBHOOK] Payment succeeded for order ${orderId}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (!orderId) {
          console.error("No orderId in payment intent metadata");
          break;
        }

        // Update payment record with failed status
        await prisma.payment.upsert({
          where: { orderId },
          create: {
            orderId,
            amountCents: paymentIntent.amount,
            currency: paymentIntent.currency.toUpperCase(),
            status: PaymentStatus.FAILED,
            provider: "STRIPE",
            providerRef: paymentIntent.id,
          },
          update: {
            status: PaymentStatus.FAILED,
            providerRef: paymentIntent.id,
          },
        });

        console.log(`[STRIPE WEBHOOK] Payment failed for order ${orderId}`);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        // Handle refunds if needed
        console.log(`[STRIPE WEBHOOK] Charge refunded: ${charge.id}`);
        break;
      }

      default:
        console.log(`[STRIPE WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ ok: true }, { status: 200 });

  } catch (err: any) {
    console.error("[STRIPE WEBHOOK] Error processing event:", err);
    return NextResponse.json(
      { ok: false, error: "PROCESSING_ERROR" },
      { status: 500 }
    );
  }
}

// Disable body parsing for raw body access
export const config = {
  api: {
    bodyParser: false,
  },
};
