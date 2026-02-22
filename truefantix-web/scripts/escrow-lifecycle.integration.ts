import { prisma } from "../src/lib/prisma";
import { OrderStatus, PaymentStatus, TicketStatus, TicketVerificationStatus } from "@prisma/client";
import { deriveEscrowState } from "../src/lib/escrow";
import { POST as deliverOrder } from "../src/app/api/admin/orders/[id]/deliver/route";
import { POST as completeOrder } from "../src/app/api/admin/orders/[id]/complete/route";

async function main() {
  const runTag = `it-${Date.now()}`;

  const seller = await prisma.seller.create({ data: { name: `Seller ${runTag}` } });
  const buyer = await prisma.seller.create({ data: { name: `Buyer ${runTag}` } });
  const event = await prisma.event.create({ data: { title: `Event ${runTag}`, venue: "Test Venue", date: "2026-03-01" } });

  const ticket = await prisma.ticket.create({
    data: {
      title: `Ticket ${runTag}`,
      priceCents: 10000,
      faceValueCents: 10000,
      image: "/default.jpg",
      venue: "Test Venue",
      date: "2026-03-01",
      status: TicketStatus.RESERVED,
      reservedByOrderId: `order-${runTag}`,
      reservedUntil: new Date(Date.now() + 15 * 60_000),
      verificationStatus: TicketVerificationStatus.VERIFIED,
      sellerId: seller.id,
      eventId: event.id,
    },
  });

  const order = await prisma.order.create({
    data: {
      id: `order-${runTag}`,
      sellerId: seller.id,
      buyerSellerId: buyer.id,
      status: OrderStatus.PAID,
      amountCents: 10000,
      adminFeeCents: 875,
      totalCents: 10875,
      items: {
        create: [{ ticketId: ticket.id, priceCents: 10000, faceValueCents: 10000 }],
      },
      payment: {
        create: {
          amountCents: 10875,
          currency: "CAD",
          status: PaymentStatus.SUCCEEDED,
          provider: "STRIPE",
          providerRef: `pi_${runTag}`,
        },
      },
    },
    include: { payment: true },
  });

  const statePaid = deriveEscrowState({ orderStatus: order.status, paymentStatus: order.payment?.status ?? null });
  if (statePaid !== "FUNDS_HELD") throw new Error(`Expected FUNDS_HELD, got ${statePaid}`);

  const deliverRes = await deliverOrder(new Request(`http://localhost/api/admin/orders/${order.id}/deliver`, { method: "POST" }));
  if (!deliverRes.ok) throw new Error(`Deliver failed: ${await deliverRes.text()}`);

  const afterDeliver = await prisma.order.findUnique({ where: { id: order.id }, include: { payment: true } });
  if (!afterDeliver) throw new Error("Order missing after deliver");
  const stateDelivered = deriveEscrowState({ orderStatus: afterDeliver.status, paymentStatus: afterDeliver.payment?.status ?? null });
  if (stateDelivered !== "RELEASE_READY") throw new Error(`Expected RELEASE_READY, got ${stateDelivered}`);

  const completeRes = await completeOrder(new Request(`http://localhost/api/admin/orders/${order.id}/complete`, { method: "POST" }));
  if (!completeRes.ok) throw new Error(`Complete failed: ${await completeRes.text()}`);

  const afterComplete = await prisma.order.findUnique({ where: { id: order.id }, include: { payment: true } });
  if (!afterComplete) throw new Error("Order missing after complete");
  const stateCompleted = deriveEscrowState({ orderStatus: afterComplete.status, paymentStatus: afterComplete.payment?.status ?? null });
  if (stateCompleted !== "RELEASED") throw new Error(`Expected RELEASED, got ${stateCompleted}`);

  const payout = await prisma.payout.findFirst({ where: { providerRef: `order:${order.id}` } });
  if (!payout) throw new Error("Expected payout record from escrow release");

  console.log("✅ Escrow lifecycle integration passed", {
    orderId: order.id,
    states: [statePaid, stateDelivered, stateCompleted],
    payoutId: payout.id,
  });
}

main()
  .catch((e) => {
    console.error("❌ Escrow lifecycle integration failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
