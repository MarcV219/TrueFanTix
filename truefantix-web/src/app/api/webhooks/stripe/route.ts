export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, generatePurchaseConfirmationEmail, generateSaleNotificationEmail } from "@/lib/email";
import { notifyTicketSold, notifyPurchaseConfirmed } from "@/lib/notifications/service";

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
    // Idempotency: check if we've already processed this event
    const existingEvent = await prisma.eventDelivery.findUnique({
      where: { eventId: event.id },
    });
    if (existingEvent) {
      console.log(`[STRIPE WEBHOOK] Event ${event.id} already processed - skipping`);
      return NextResponse.json({ ok: true, replay: true }, { status: 200 });
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (!orderId) {
          console.error("No orderId in payment intent metadata");
          break;
        }

        // Update order and payment status
        const updatedOrder = await prisma.$transaction(async (tx: any) => {
          // Create or update payment record
          await tx.payment.upsert({
            where: { orderId },
            create: {
              orderId,
              amountCents: paymentIntent.amount,
              currency: paymentIntent.currency.toUpperCase(),
              status: "SUCCEEDED",
              provider: "STRIPE",
              providerRef: paymentIntent.id,
            },
            update: {
              status: "SUCCEEDED",
              providerRef: paymentIntent.id,
            },
          });

          // Escrow hold: payment succeeded means funds are held.
          // Keep delivery finalization separate (admin deliver route).
          const order = await tx.order.update({
            where: { id: orderId },
            data: { status: "PAID" },
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

        // Send confirmation email to buyer (idempotent)
        if (updatedOrder.buyerSeller?.user) {
          const buyer = updatedOrder.buyerSeller.user;
          const existingBuyerEmail = await prisma.emailDelivery.findUnique({
            where: {
              orderId_emailType_recipient: {
                orderId: updatedOrder.id,
                emailType: "PURCHASE_CONFIRMATION",
                recipient: buyer.email,
              },
            },
          });

          if (!existingBuyerEmail) {
            const tickets = updatedOrder.items.map((item: { ticket?: { title?: string; venue?: string; date?: string } }) => ({
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

            const emailResult = await sendEmail({
              to: buyer.email,
              subject: emailContent.subject,
              text: emailContent.text,
              html: emailContent.html,
            });

            await prisma.emailDelivery.create({
              data: {
                orderId: updatedOrder.id,
                emailType: "PURCHASE_CONFIRMATION",
                recipient: buyer.email,
                provider: process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE",
                status: emailResult.ok ? "SENT" : "FAILED",
                error: emailResult.error ?? null,
              },
            });
          } else {
            console.log(`[STRIPE WEBHOOK] Buyer email already sent for order ${orderId}`);
          }
        }

        // Send notification email to seller (idempotent)
        if (updatedOrder.seller?.user && updatedOrder.items.length > 0) {
          const seller = updatedOrder.seller.user;
          const existingSellerEmail = await prisma.emailDelivery.findUnique({
            where: {
              orderId_emailType_recipient: {
                orderId: updatedOrder.id,
                emailType: "SALE_NOTIFICATION",
                recipient: seller.email,
              },
            },
          });

          if (!existingSellerEmail) {
            const firstTicket = updatedOrder.items[0].ticket;
            const amount = (updatedOrder.amountCents / 100).toFixed(2);

            const emailContent = generateSaleNotificationEmail(
              updatedOrder.id,
              seller.firstName,
              firstTicket?.title || "Ticket",
              amount
            );

            const emailResult = await sendEmail({
              to: seller.email,
              subject: emailContent.subject,
              text: emailContent.text,
              html: emailContent.html,
            });

            await prisma.emailDelivery.create({
              data: {
                orderId: updatedOrder.id,
                emailType: "SALE_NOTIFICATION",
                recipient: seller.email,
                provider: process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE",
                status: emailResult.ok ? "SENT" : "FAILED",
                error: emailResult.error ?? null,
              },
            });
          } else {
            console.log(`[STRIPE WEBHOOK] Seller email already sent for order ${orderId}`);
          }
        }

        // Send in-app notifications (fire-and-forget, non-blocking)
        try {
          if (updatedOrder.buyerSeller?.user) {
            const firstTicket = updatedOrder.items[0]?.ticket;
            await notifyPurchaseConfirmed({
              buyerUserId: updatedOrder.buyerSeller.user.id,
              ticketTitle: firstTicket?.title || "Ticket",
              orderId: updatedOrder.id,
            });
          }
          if (updatedOrder.seller?.user && updatedOrder.items.length > 0) {
            const firstTicket = updatedOrder.items[0].ticket;
            await notifyTicketSold({
              sellerUserId: updatedOrder.seller.user.id,
              ticketTitle: firstTicket?.title || "Ticket",
              orderId: updatedOrder.id,
              amount: updatedOrder.amountCents,
            });
          }
        } catch (notifyErr) {
          // Log but don't fail the webhook if notifications fail
          console.error("[STRIPE WEBHOOK] Failed to send notifications:", notifyErr);
        }

        console.log(`[STRIPE WEBHOOK] Payment succeeded for order ${orderId}`);

        // Record event delivery for idempotency
        await prisma.eventDelivery.create({
          data: {
            eventId: event.id,
            eventType: event.type,
            orderId,
          },
        });
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
            status: "FAILED",
            provider: "STRIPE",
            providerRef: paymentIntent.id,
          },
          update: {
            status: "FAILED",
            providerRef: paymentIntent.id,
          },
        });

        console.log(`[STRIPE WEBHOOK] Payment failed for order ${orderId}`);

        // Record event delivery for idempotency
        await prisma.eventDelivery.create({
          data: {
            eventId: event.id,
            eventType: event.type,
            orderId,
          },
        });
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

// App Router note: request body is read via req.text(); no pages-style `config` export needed.
