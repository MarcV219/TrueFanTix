export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseOrderAccessTokenHolds } from "@/lib/accessTokenHolds";
import {
  sendEmail,
  generatePurchaseConfirmationEmail,
  generateSaleNotificationEmail,
  type EmailPayload,
  type EmailSendResult,
} from "@/lib/email";
import { notifyTicketSold, notifyPurchaseConfirmed } from "@/lib/notifications/service";
import { notifySellerTransferRequired, sellerTransferDeadline } from "@/lib/orders/transferWorkflow";
import { ADMIN_ACTIVITY_EMAIL, sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import { reportProductionIncident } from "@/lib/productionIncidents";
import { emailProviderEvidence } from "@/lib/emailProviderConfig";
import { isReservationExpired } from "@/lib/tickets/reservation-expiry";

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
    const raw = event.data?.object?.metadata?.orderId;
    return typeof raw === "string" ? raw.trim() : undefined;
  }
  return undefined;
}

async function sendEmailWithProviderEvidence(payload: EmailPayload): Promise<EmailSendResult> {
  try {
    return await sendEmail(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    return {
      ok: false,
      provider: "CONSOLE",
      providerResult: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE",
      error: `EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: ${message}`,
    };
  }
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
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, error: "MISSING_SIGNATURE" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ ok: false, error: "CONFIG_ERROR" }, { status: 500 });
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
        const orderId = typeof paymentIntent.metadata?.orderId === "string" ? paymentIntent.metadata.orderId.trim() : "";

        if (!orderId) {
          console.error("No orderId in payment intent metadata");
          break;
        }

        const updatedOrder = await prisma.$transaction(async (tx: any) => {
          const now = new Date();
          await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
          await tx.$queryRaw`
            SELECT ticket."id"
            FROM "Ticket" ticket
            INNER JOIN "OrderItem" item ON item."ticketId" = ticket."id"
            WHERE item."orderId" = ${orderId}
            ORDER BY ticket."id"
            FOR UPDATE OF ticket
          `;
          const candidate = await tx.order.findUnique({
            where: { id: orderId },
            include: { items: { include: { ticket: true } }, payment: true },
          });

          const currency = String(paymentIntent.currency || "").toUpperCase();
          const reservationsMatch = candidate?.items?.length > 0 && candidate.items.every(
            ({ ticket }: any) =>
              ticket.status === "RESERVED" &&
              ticket.reservedByOrderId === orderId &&
              ticket.reservedUntil instanceof Date &&
              !isReservationExpired(ticket.reservedUntil, now),
          );
          if (
            !candidate ||
            candidate.status !== "PENDING" ||
            candidate.totalCents !== paymentIntent.amount ||
            candidate.currency.toUpperCase() !== currency ||
            !candidate.payment ||
            candidate.payment.status !== "REQUIRES_PAYMENT" ||
            candidate.payment.provider !== "STRIPE" ||
            candidate.payment.providerRef !== paymentIntent.id ||
            candidate.payment.amountCents !== paymentIntent.amount ||
            candidate.payment.currency.toUpperCase() !== currency ||
            !reservationsMatch
          ) return null;

          const paymentUpdated = await tx.payment.updateMany({
            where: {
              id: candidate.payment.id,
              status: "REQUIRES_PAYMENT",
              provider: "STRIPE",
              providerRef: paymentIntent.id,
              amountCents: paymentIntent.amount,
              currency,
            },
            data: { status: "SUCCEEDED" },
          });
          const orderUpdated = await tx.order.updateMany({
            where: { id: orderId, status: "PENDING" },
            data: { status: "PAID" },
          });
          if (paymentUpdated.count !== 1 || orderUpdated.count !== 1) {
            throw new Error("PAYMENT_SUCCESS_TRANSITION_FENCE_LOST");
          }

          const ticketsUpdated = await tx.ticket.updateMany({
            where: { status: "RESERVED", reservedByOrderId: orderId, reservedUntil: { gt: now } },
            data: { status: "SOLD", soldAt: now, reservedByOrderId: null, reservedUntil: null },
          });
          if (ticketsUpdated.count !== candidate.items.length) {
            throw new Error("PAYMENT_SUCCESS_TICKET_FENCE_LOST");
          }

          const order = await tx.order.update({
            where: { id: orderId },
            data: {},
            include: {
              items: { include: { ticket: true } },
              payment: true,
              buyerSeller: { include: { user: true } },
              seller: { include: { user: true } },
            },
          });

          return order;
        });

        if (!updatedOrder) {
          console.error(`[STRIPE WEBHOOK] Quarantined mismatched success event ${event.id}`);
          return NextResponse.json({ ok: false, error: "PAYMENT_EVENT_CONFLICT" }, { status: 409 });
        }

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

            const emailResult = await sendEmailWithProviderEvidence({
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
                provider: emailProviderEvidence(emailResult),
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

            const emailResult = await sendEmailWithProviderEvidence({
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
                provider: emailProviderEvidence(emailResult),
                status: emailResult.ok ? "SENT" : "FAILED",
                error: emailResult.error ?? null,
              },
            });
          }
        }

        const existingAdminEmail = await prisma.emailDelivery.findUnique({
          where: {
            orderId_emailType_recipient: {
              orderId: updatedOrder.id,
              emailType: "ADMIN_PURCHASE_COMPLETED",
              recipient: ADMIN_ACTIVITY_EMAIL,
            },
          },
        });
        if (!existingAdminEmail) {
          const adminEmailResult = await sendAdminActivityEmail({
            activity: "TICKETS_PURCHASED",
            summary: `Tickets purchased — order ${updatedOrder.id}`,
            details: {
              "Order ID": updatedOrder.id,
              Buyer: updatedOrder.buyerSeller?.user?.email,
              Seller: updatedOrder.seller?.user?.email,
              "Ticket count": updatedOrder.items.length,
              Total: `${String(updatedOrder.payment?.currency || paymentIntent.currency || "CAD").toUpperCase()} ${(updatedOrder.totalCents / 100).toFixed(2)}`,
              Events: updatedOrder.items.map((item: any) => item.ticket?.title || "Ticket").join(", "),
            },
          });
          await prisma.emailDelivery.create({
            data: {
              orderId: updatedOrder.id,
              emailType: "ADMIN_PURCHASE_COMPLETED",
              recipient: ADMIN_ACTIVITY_EMAIL,
              provider: emailProviderEvidence(adminEmailResult),
              status: adminEmailResult.ok ? "SENT" : "FAILED",
              error: adminEmailResult.error ?? null,
            },
          });
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
            await notifySellerTransferRequired({
              sellerUserId: updatedOrder.seller.user.id,
              orderId: updatedOrder.id,
              ticketCount: updatedOrder.items.length,
              deadline: sellerTransferDeadline(updatedOrder),
              now: new Date(),
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
        const orderId = typeof paymentIntent.metadata?.orderId === "string" ? paymentIntent.metadata.orderId.trim() : "";

        if (!orderId) {
          console.error("No orderId in payment intent metadata");
          break;
        }

        const failed = await prisma.$transaction(async (tx: any) => {
          await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
          const candidate = await tx.order.findUnique({
            where: { id: orderId },
            include: { payment: true },
          });
          const currency = String(paymentIntent.currency || "").toUpperCase();
          if (
            !candidate || candidate.status !== "PENDING" ||
            !candidate.payment || candidate.payment.status !== "REQUIRES_PAYMENT" ||
            candidate.payment.provider !== "STRIPE" || candidate.payment.providerRef !== paymentIntent.id ||
            candidate.payment.amountCents !== paymentIntent.amount ||
            candidate.payment.currency.toUpperCase() !== currency
          ) return false;

          const cancelled = await tx.order.updateMany({
            where: { id: orderId, status: "PENDING" },
            data: { status: "CANCELLED" },
          });
          if (cancelled.count !== 1) throw new Error("PAYMENT_FAILURE_TRANSITION_FENCE_LOST");

          const paymentUpdated = await tx.payment.updateMany({
            where: { id: candidate.payment.id, status: "REQUIRES_PAYMENT", providerRef: paymentIntent.id },
            data: { status: "FAILED" },
          });
          if (paymentUpdated.count !== 1) throw new Error("PAYMENT_FAILURE_PAYMENT_FENCE_LOST");

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
          return true;
        });

        if (!failed) {
          console.error(`[STRIPE WEBHOOK] Quarantined stale/conflicting failure event ${event.id}`);
          return NextResponse.json({ ok: false, error: "PAYMENT_EVENT_CONFLICT" }, { status: 409 });
        }

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
    await reportProductionIncident({
      category: "STRIPE_WEBHOOK",
      severity: "CRITICAL",
      summary: "Stripe webhook processing failed",
      error: err,
      references: { eventId: event.id, eventType: event.type, orderId: getOrderIdFromEvent(event) },
      fingerprint: `stripe-webhook:${event.type}`,
    });
    return NextResponse.json({ ok: false, error: "PROCESSING_ERROR" }, { status: 500 });
  }
}
