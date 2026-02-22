import { prisma } from "../src/lib/prisma";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { deriveEscrowState } from "../src/lib/escrow";

async function applySucceededWebhookLikeUpdate(orderId: string, providerRef: string, totalCents: number) {
  await prisma.$transaction(async (tx) => {
    await tx.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        amountCents: totalCents,
        currency: "CAD",
        status: PaymentStatus.SUCCEEDED,
        provider: "STRIPE",
        providerRef,
      },
      update: {
        status: PaymentStatus.SUCCEEDED,
        providerRef,
      },
    });

    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID },
    });
  });
}

async function main() {
  const runTag = `drill-${Date.now()}`;
  const seller = await prisma.seller.create({ data: { name: `Seller ${runTag}` } });
  const buyer = await prisma.seller.create({ data: { name: `Buyer ${runTag}` } });

  const order = await prisma.order.create({
    data: {
      sellerId: seller.id,
      buyerSellerId: buyer.id,
      status: OrderStatus.PENDING,
      amountCents: 5000,
      adminFeeCents: 438,
      totalCents: 5438,
    },
  });

  // First webhook delivery
  await applySucceededWebhookLikeUpdate(order.id, `pi_${runTag}_1`, order.totalCents);
  let withPayment = await prisma.order.findUnique({ where: { id: order.id }, include: { payment: true } });
  if (!withPayment) throw new Error("Order missing after first replay");
  const firstState = deriveEscrowState({
    orderStatus: withPayment.status,
    paymentStatus: withPayment.payment?.status ?? null,
  });

  // Replay same event (or duplicate delivery)
  await applySucceededWebhookLikeUpdate(order.id, `pi_${runTag}_1`, order.totalCents);
  withPayment = await prisma.order.findUnique({ where: { id: order.id }, include: { payment: true } });
  if (!withPayment) throw new Error("Order missing after second replay");
  const secondState = deriveEscrowState({
    orderStatus: withPayment.status,
    paymentStatus: withPayment.payment?.status ?? null,
  });

  if (firstState !== "FUNDS_HELD" || secondState !== "FUNDS_HELD") {
    throw new Error(`Unexpected escrow states: ${firstState} -> ${secondState}`);
  }

  console.log("✅ Stripe webhook replay drill passed", {
    orderId: order.id,
    stateAfterFirst: firstState,
    stateAfterReplay: secondState,
    paymentStatus: withPayment.payment?.status,
  });
}

main()
  .catch((e) => {
    console.error("❌ Stripe webhook replay drill failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
