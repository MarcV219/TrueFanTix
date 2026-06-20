import { prisma } from "@/lib/prisma";
import { isTicketEventExpired } from "@/lib/tickets/expiry";

export async function withdrawExpiredAvailableTickets(now = new Date()) {
  const candidates = await prisma.ticket.findMany({
    where: {
      status: "AVAILABLE",
      soldAt: null,
      withdrawnAt: null,
    },
    select: {
      id: true,
      date: true,
      venue: true,
      event: {
        select: {
          date: true,
          venue: true,
        },
      },
    },
  });

  const expiredIds = candidates
    .filter((ticket) =>
      isTicketEventExpired(
        {
          date: ticket.date || ticket.event?.date,
          venue: ticket.venue || ticket.event?.venue,
        },
        now
      )
    )
    .map((ticket) => ticket.id);

  if (!expiredIds.length) return { withdrawn: 0 };

  const result = await prisma.ticket.updateMany({
    where: {
      id: { in: expiredIds },
      status: "AVAILABLE",
    },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: now,
      reservedByOrderId: null,
      reservedUntil: null,
    },
  });

  return { withdrawn: result.count };
}
