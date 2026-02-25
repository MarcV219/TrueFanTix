import { prisma } from "./prisma";

export type NotificationType = 
  | "NEW_EVENT"           // New event matching user's preferences
  | "TICKET_LISTED"       // New ticket listed for event user follows
  | "TICKET_SOLD"         // Your ticket was sold
  | "TICKET_PRICE_DROP"   // Price dropped on ticket you're watching
  | "ORDER_CONFIRMED"     // Purchase confirmed
  | "TRANSFER_RECEIVED"   // Tickets transferred to you
  | "ESCROW_RELEASED"     // Funds released from escrow
  | "VERIFICATION_NEEDED" // Ticket needs verification
  | "PAYOUT_PROCESSED"    // Payout completed
  | "DISPUTE_OPENED"      // Dispute opened on order
  | "SYSTEM";             // General system notifications

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  message: string;
  link?: string;
}

/**
 * Create a notification for a specific user
 */
export async function createNotification({
  userId,
  type,
  message,
  link,
}: CreateNotificationParams) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        message,
        link,
        isRead: false,
      },
    });

    return { ok: true, notification };
  } catch (err) {
    console.error("Failed to create notification:", err);
    return { ok: false, error: err };
  }
}

/**
 * Notify users who have preferences matching an event/ticket
 */
export async function notifyMatchingUsers({
  type,
  message,
  link,
  eventId,
  artist,
  venue,
  city,
}: {
  type: NotificationType;
  message: string;
  link?: string;
  eventId?: string;
  artist?: string;
  venue?: string;
  city?: string;
}) {
  try {
    // Build a query to find users with matching preferences
    const orConditions = [];
    
    if (artist) {
      orConditions.push({ type: "ARTIST", value: artist, status: "ACTIVE" });
    }
    if (venue) {
      orConditions.push({ type: "VENUE", value: venue, status: "ACTIVE" });
    }
    if (city) {
      orConditions.push({ type: "CITY", value: city, status: "ACTIVE" });
    }

    if (orConditions.length === 0) {
      return { ok: true, count: 0 };
    }

    // Find matching preferences
    const matchingPreferences = await prisma.notificationPreference.findMany({
      where: {
        OR: orConditions,
      },
      select: {
        userId: true,
      },
      distinct: ["userId"],
    });

    // Create notifications for each matching user
    const userIds = matchingPreferences.map((pref) => pref.userId);
    
    if (userIds.length === 0) {
      return { ok: true, count: 0 };
    }

    // Bulk create notifications
    const notifications = await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        message,
        link,
        isRead: false,
      })),
    });

    return { ok: true, count: notifications.count };
  } catch (err) {
    console.error("Failed to notify matching users:", err);
    return { ok: false, error: err };
  }
}

/**
 * Notify when a new ticket is listed
 */
export async function notifyNewTicketListed(ticket: {
  id: string;
  title: string;
  event?: { title: string; venue?: string | null } | null;
  seller: { name: string };
}) {
  const message = `New ticket listed: ${ticket.title}${ticket.event ? ` for ${ticket.event.title}` : ""} by ${ticket.seller.name}`;
  const link = `/tickets/${ticket.id}`;

  return notifyMatchingUsers({
    type: "TICKET_LISTED",
    message,
    link,
    artist: ticket.title, // Assuming title contains artist name
    venue: ticket.event?.venue || undefined,
  });
}

/**
 * Notify seller when their ticket is sold
 */
export async function notifyTicketSold(params: {
  sellerUserId: string;
  ticketTitle: string;
  orderId: string;
  amount: number;
}) {
  const { sellerUserId, ticketTitle, orderId, amount } = params;
  
  return createNotification({
    userId: sellerUserId,
    type: "TICKET_SOLD",
    message: `Your ticket "${ticketTitle}" was sold for $${(amount / 100).toFixed(2)}!`,
    link: `/orders/${orderId}`,
  });
}

/**
 * Notify buyer when purchase is confirmed
 */
export async function notifyPurchaseConfirmed(params: {
  buyerUserId: string;
  ticketTitle: string;
  orderId: string;
}) {
  const { buyerUserId, ticketTitle, orderId } = params;
  
  return createNotification({
    userId: buyerUserId,
    type: "ORDER_CONFIRMED",
    message: `Your purchase of "${ticketTitle}" is confirmed!`,
    link: `/orders/${orderId}`,
  });
}

/**
 * Notify when escrow is released
 */
export async function notifyEscrowReleased(params: {
  sellerUserId: string;
  amount: number;
  orderId: string;
}) {
  const { sellerUserId, amount, orderId } = params;
  
  return createNotification({
    userId: sellerUserId,
    type: "ESCROW_RELEASED",
    message: `$${(amount / 100).toFixed(2)} has been released from escrow to your account.`,
    link: `/orders/${orderId}`,
  });
}
