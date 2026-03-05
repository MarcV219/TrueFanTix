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

async function verifySignature(payload: string, signature: string, secret: string) {
  const stripe = await getStripe();
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return { success: true, event };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function isUniqueConstraintError(err: any): boolean {
  return err?.code === "P2002" || String(err?.message ?? "").includes("Unique constraint");
}

function getOrderIdFromEvent(event: any): string | undefined {
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    return event.data?.object?.metadata?.orderId;
  }
  return undefined;
}

async function claimEventDelivery(event: any) {
  try {
    await prisma.eventDelivery.create({
      data: {
        eventId: event.id,
        eventType: event.type,
        orderId: getOrderIdFromEvent(event),
      },
    });
    return { claimed: true as const };
  } catch (err: any) {
    if (isUniqueConstraintError(err)) {
      return { claimed: false as const };
    }
    throw err;
  }
}

async function releaseEventClaim(eventId: string) {
  await prisma.eventDelivery.deleteMany({ where: { eventId } }).catch(() => undefined);
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ ok: false, error: "CONFIG_ERROR" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "MISSING_SIGNATURE" }, { status: 400 });
  }

  const payload = await req.text();
  const verification = await verifySignature(payload, signature, webhookSecret);

  if (!verification.success) {
    console.error("Webhook signature verification failed:", verification.error);
    return NextResponse.json({ ok: false, error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  const event = verification.event;

  try {
    const claim = await claimEventDelivery(event);
    if (!claim.claimed) {
      console.log(`[STRIPE WEBHOOK] Event ${event.id} already claimed/processed - skipping`);
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

        const updatedOrder = await prisma.$transaction(async (tx: any) => {
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

          const order = await tx.order.update({
            where: { id: orderId },
            data: { status: "PAID" },
            include: {
              items: { include: { ticket: true } },
              buyerSeller: { include: { user: true } },
              seller: { include: { user: true } },
            },
          });

          return order;
        });

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

            const emailContent = generatePurchaseConfirmationEmail(updatedOrder.id, buyer.firstName, tickets, total);

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
          }
        }

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
          }
        }

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
          console.error("[STRIPE WEBHOOK] Failed to send notifications:", notifyErr);
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
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        console.log(`[STRIPE WEBHOOK] Charge refunded: ${charge.id}`);
        break;
      }

      default:
        console.log(`[STRIPE WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    await releaseEventClaim(event.id);
    console.error("[STRIPE WEBHOOK] Error processing event:", err);
    return NextResponse.json({ ok: false, error: "PROCESSING_ERROR" }, { status: 500 });
  }
}
