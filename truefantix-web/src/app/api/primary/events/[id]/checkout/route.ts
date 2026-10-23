export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePrimaryPilotBuyer } from "@/lib/primary/pilot-auth";
import { PrimaryReservationService } from "@/lib/primary/reservation-service";
import { createPrimaryOrderInternalCapability, PrimaryOrderService } from "@/lib/primary/order-service";
import { PrimaryPaymentService, requirePrimaryStripePublishableTestKey, requirePrimaryStripeTestConfig, StripeTestModeAdapter } from "@/lib/primary/payment-service";
import { PrimaryAccessError } from "@/lib/primary/authorization";
import { PrimaryDomainError } from "@/lib/primary/organizer-service";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePrimaryPilotBuyer(req);
  if (!gate.ok) return gate.res;
  try {
    const { id: eventId } = await context.params;
    const body = await req.json().catch(() => null) as { ticketTypeId?: unknown; quantity?: unknown; idempotencyKey?: unknown } | null;
    const ticketTypeId = typeof body?.ticketTypeId === "string" ? body.ticketTypeId.trim() : "";
    const quantity = Number(body?.quantity);
    const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!ticketTypeId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10 || !idempotencyKey || idempotencyKey.length > 200) {
      return noStore(NextResponse.json({ ok: false, error: "INVALID_CHECKOUT" }, { status: 400 }));
    }
    const stripeConfig = requirePrimaryStripeTestConfig(gate.capability);
    const publishableKey = requirePrimaryStripePublishableTestKey(gate.capability);
    const ticketType = await prisma.primaryTicketType.findFirst({ where: { id: ticketTypeId, eventId, status: "ACTIVE", event: { status: "APPROVED", organizer: { status: "APPROVED" } } } });
    if (!ticketType) return noStore(NextResponse.json({ ok: false, error: "EVENT_NOT_FOUND" }, { status: 404 }));
    const actor = { id: gate.user.id, role: gate.user.role };
    const reservationService = new PrimaryReservationService(prisma, gate.capability);
    const reservation = await reservationService.createHold({ actor, organizerId: ticketType.organizerId, eventId, ticketTypeId, quantity, idempotencyKey: `${idempotencyKey}:hold` });
    const internal = createPrimaryOrderInternalCapability(gate.capability);
    const orderService = new PrimaryOrderService(prisma, gate.capability);
    const order = await orderService.create({ internalCapability: internal, actor, organizerId: ticketType.organizerId, eventId, reservationId: reservation.id, idempotencyKey: `${idempotencyKey}:order` });
    const paymentService = new PrimaryPaymentService(prisma, gate.capability, stripeConfig, new StripeTestModeAdapter(stripeConfig), orderService);
    const attempt = await paymentService.createAttempt({ internalCapability: internal, organizerId: ticketType.organizerId, eventId, orderId: order.id, idempotencyKey: `${idempotencyKey}:payment` });
    if (!attempt.clientSecret) throw new PrimaryDomainError("PAYMENT_CLIENT_SECRET_UNAVAILABLE");
    return noStore(NextResponse.json({ ok: true, checkout: { orderId: order.id, reservationId: reservation.id, expiresAt: reservation.expiresAt.toISOString(), amountMinor: order.grossTotalMinor, currency: order.currency, clientSecret: attempt.clientSecret, publishableKey } }));
  } catch (error) {
    const code = error instanceof PrimaryDomainError || error instanceof PrimaryAccessError ? error.code : "CHECKOUT_FAILED";
    const status = error instanceof PrimaryAccessError ? error.status : code === "INSUFFICIENT_RESERVABLE_CAPACITY" ? 409 : 400;
    return noStore(NextResponse.json({ ok: false, error: code, requestId: randomUUID() }, { status }));
  }
}
