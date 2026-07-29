import { prisma } from "@/lib/prisma";
import { sellerTransferDeadline } from "@/lib/orders/transferWorkflow";
import { visibleAdminRequests } from "@/lib/dispute-case";

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export async function getSellerHoldingOrders(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { seller: true },
  });

  if (!user?.seller) return [];

  const orders = await prisma.order.findMany({
    where: {
      sellerId: user.seller.id,
      status: { in: ["PAID", "DELIVERED"] },
    },
    include: {
      payment: true,
      buyerSeller: { include: { user: true } },
      items: {
        include: {
          ticket: { include: { event: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    amount: centsToDollars(order.amountCents),
    total: centsToDollars(order.totalCents),
    createdAt: order.createdAt.toISOString(),
    transferDeadline: sellerTransferDeadline(order).toISOString(),
    transferProofType: order.transferProofType,
    transferProofData: order.transferProofData,
    transferVerificationStatus: order.transferVerificationStatus,
    buyerConfirmationStatus: order.buyerConfirmationStatus,
    buyerConfirmationAt: order.buyerConfirmationAt?.toISOString() ?? null,
    buyerConfirmationDeadline: order.disputeWindowEndsAt?.toISOString() ?? null,
    adminRequests: visibleAdminRequests(order.transferVerificationReason, "SELLER"),
    buyer: order.buyerSeller.user
      ? {
          name:
            order.buyerSeller.user.displayName ||
            `${order.buyerSeller.user.firstName} ${order.buyerSeller.user.lastName}`.trim(),
          email: order.buyerSeller.user.email,
        }
      : null,
    tickets: order.items.map((item) => ({
      id: item.ticket.id,
      title: item.ticket.title,
      venue: item.ticket.venue,
      date: item.ticket.date,
      price: centsToDollars(item.priceCents),
      image: item.ticket.image,
      row: item.ticket.row,
      seat: item.ticket.seat,
      status: item.ticket.status,
    })),
  }));
}
