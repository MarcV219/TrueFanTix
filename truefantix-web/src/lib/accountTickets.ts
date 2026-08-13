import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleAdminRequests } from "@/lib/dispute-case";

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export async function getBuyerTickets(userId: string, statuses: OrderStatus[]) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { seller: true },
  });

  if (!user?.seller) return [];

  const orders = await prisma.order.findMany({
    where: {
      buyerSellerId: user.seller.id,
      status: { in: statuses },
    },
    include: {
      seller: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        include: {
          ticket: {
            include: { event: true },
          },
        },
      },
      reviews: {
        select: {
          id: true,
          rating: true,
          content: true,
          createdAt: true,
        },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return orders.flatMap((order) =>
    order.items.map((item) => ({
      id: item.ticket.id,
      title: item.ticket.title,
      venue: item.ticket.venue,
      date: item.ticket.date,
      section: item.ticket.section,
      row: item.ticket.row,
      seat: item.ticket.seat,
      price: centsToDollars(item.priceCents),
      image: item.ticket.image,
      status: item.ticket.status,
      orderStatus: order.status,
      transferVerificationStatus: order.transferVerificationStatus,
      buyerConfirmationStatus: order.buyerConfirmationStatus,
      buyerConfirmationDeadline: order.disputeWindowEndsAt?.toISOString() ?? null,
      adminRequests: visibleAdminRequests(order.transferVerificationReason, "BUYER"),
      orderId: order.id,
      orderDate: order.createdAt.toISOString(),
      seller: order.seller,
      review: order.reviews[0]
        ? {
            ...order.reviews[0],
            createdAt: order.reviews[0].createdAt.toISOString(),
          }
        : null,
    }))
  );
}
