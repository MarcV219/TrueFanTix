export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { PrimaryOrderService } from "@/lib/primary/order-service";
import { PrimaryPaymentService, requirePrimaryStripeTestConfig, StripeTestModeAdapter } from "@/lib/primary/payment-service";
import { createPrimaryAdmissionInternalCapability, PrimaryAdmissionService, requirePrimaryAdmissionTestConfig } from "@/lib/primary/admission-service";

export async function POST(req: Request) {
  try {
    const capability = requirePrimaryPreflight();
    if (capability.environmentId !== "isolated-preview" || process.env.VERCEL_ENV !== "preview") return NextResponse.json({ ok: false }, { status: 404 });
    const stripeConfig = requirePrimaryStripeTestConfig(capability);
    const admissionConfig = requirePrimaryAdmissionTestConfig(capability);
    const signature = req.headers.get("stripe-signature");
    if (!signature) return NextResponse.json({ ok: false }, { status: 400 });
    const rawBody = await req.text();
    const orderService = new PrimaryOrderService(prisma, capability);
    const paymentService = new PrimaryPaymentService(prisma, capability, stripeConfig, new StripeTestModeAdapter(stripeConfig), orderService);
    const providerEvent = await paymentService.handleWebhook(rawBody, signature);
    const attempt = await prisma.primaryPaymentAttempt.findUnique({ where: { id: providerEvent.attemptId } });
    if (attempt?.status === "SUCCEEDED") {
      const admission = new PrimaryAdmissionService(prisma, capability, admissionConfig);
      await admission.issue({ internalCapability: createPrimaryAdmissionInternalCapability(capability), organizerId: attempt.organizerId, eventId: attempt.eventId, orderId: attempt.orderId, idempotencyKey: `payment:${attempt.id}:issue` });
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }
}
