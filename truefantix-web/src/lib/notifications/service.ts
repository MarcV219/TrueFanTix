import { prisma } from "../prisma";
import { haversineKm, inferCityCoordsFromVenue, inferCoordsFromCity, parseVenue } from "@/lib/ticketsView";

export type NotificationType = 
  | "NEW_EVENT"           // New event matching user's preferences
  | "TICKET_LISTED"       // New ticket listed for event user follows
  | "TICKET_SOLD"         // Your ticket was sold
  | "TICKET_PRICE_DROP"   // Price dropped on ticket you're watching
  | "ORDER_CONFIRMED"     // Purchase confirmed
  | "TRANSFER_REQUIRED"   // Seller needs to transfer tickets
  | "TRANSFER_RECEIVED"   // Tickets transferred to you
  | "TRANSFER_CONFIRMATION_REQUIRED" // Buyer needs to confirm received tickets
  | "ESCROW_RELEASED"     // Funds released from escrow
  | "VERIFICATION_NEEDED" // Ticket needs verification
  | "PAYOUT_PROCESSED"    // Payout completed
  | "DISPUTE_OPENED"      // Dispute opened on order
  | "NEW_MESSAGE"         // New message received
  | "WAITLIST_JOINED"     // Joined waitlist for event
  | "WAITLIST_AVAILABLE"  // Tickets available on waitlist
  | "REFERRAL_SIGNUP"     // New referral signup
  | "REFERRAL_COMPLETED"  // Referral completed purchase
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

export async function createNotificationOncePerWindow({
  userId,
  type,
  message,
  link,
  windowStart,
}: CreateNotificationParams & { windowStart: Date }) {
  try {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type,
        message,
        link,
        createdAt: { gte: windowStart },
      },
      select: { id: true },
    });

    if (existing) {
      return { ok: true, skipped: true };
    }

    return createNotification({ userId, type, message, link });
  } catch (err) {
    console.error("Failed to create deduped notification:", err);
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
  sport,
}: {
  type: NotificationType;
  message: string;
  link?: string;
  eventId?: string;
  artist?: string;
  venue?: string;
  city?: string;
  sport?: string;
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
    if (sport) {
      orConditions.push({ type: "SPORT", value: sport, status: "ACTIVE" });
    }

    if (orConditions.length === 0) {
      return { ok: true, count: 0 };
    }

    const eventCoords = inferCoordsFromCity(city) ?? (venue ? inferCityCoordsFromVenue(venue) : null);

    // Find matching preferences
    const matchingPreferences = await prisma.notificationPreference.findMany({
      where: {
        OR: orConditions,
      },
      select: {
        userId: true,
        user: {
          select: {
            city: true,
            notificationRadiusKm: true,
          },
        },
      },
      distinct: ["userId"],
    });

    // Create notifications for each matching user
    const userIds = matchingPreferences
      .filter((pref) => {
        const radiusKm = pref.user.notificationRadiusKm;
        if (!radiusKm || !eventCoords) return true;
        const homeCoords = inferCoordsFromCity(pref.user.city);
        if (!homeCoords) return true;
        return haversineKm(homeCoords, eventCoords) <= radiusKm;
      })
      .map((pref) => pref.userId);
    
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

function sportFromTicketTitle(title: string) {
  const lower = title.toLowerCase();
  if (lower.match(/formula 1|formula one|f1|nascar|indycar|motogp|auto racing|motor racing|motorsport|grand prix|raceway|speedway/)) return "Auto Racing";
  if (lower.match(/baseball|blue jays|yankees|red sox|dodgers|padres|mlb/)) return "Baseball";
  if (lower.match(/basketball|raptors|lakers|knicks|celtics|bulls|nba|wnba/)) return "Basketball";
  if (lower.match(/boxing|boxer|fight night/)) return "Boxing";
  if (lower.match(/curling|brier|scotties|grand slam of curling/)) return "Curling";
  if (lower.match(/football|nfl|cfl|argos|argonauts|bills|chiefs|packers|patriots|cowboys|steelers|raiders|49ers|seahawks|broncos|dolphins|jets|giants|eagles|vikings|bengals|browns|ravens|chargers|rams|lions|falcons|panthers|saints|buccaneers|titans|colts|jaguars|texans|commanders|cardinals|bears/) && !lower.includes("football club")) return "Football";
  if (lower.match(/soccer|football club|fc | cf |mls|nwsl|cpl|tfc|toronto fc|inter miami/)) return "Soccer";
  if (lower.match(/golf|pga|lpga|masters|open championship|ryder cup/)) return "Golf";
  if (lower.match(/hockey|leafs|maple leafs|canadiens|bruins|canucks|kraken|nhl|pwhl|ohl|whl|qmjhl|ahl/)) return "Hockey";
  if (lower.match(/lacrosse|nll|rock|rush|black bears/)) return "Lacrosse";
  if (lower.match(/rugby|rugby union|rugby league|mlr/)) return "Rugby";
  if (lower.match(/tennis|atp|wta|grand slam|us open|canadian open|wimbledon/)) return "Tennis";
  if (lower.match(/volleyball|pro volleyball|nations league volleyball/)) return "Volleyball";
  if (lower.match(/mixed martial arts|mma|ufc|bellator|pfl/)) return "Mixed Martial Arts";
  return null;
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
  const venue = ticket.event?.venue || undefined;
  const parsedVenue = venue ? parseVenue(venue) : null;
  const sport = sportFromTicketTitle(ticket.title) ?? undefined;

  return notifyMatchingUsers({
    type: "TICKET_LISTED",
    message,
    link,
    artist: ticket.title, // Assuming title contains artist name
    venue,
    city: parsedVenue?.city,
    sport,
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
