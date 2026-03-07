export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTicketImage } from "@/lib/imageSearch";

function dollarsToCents(dollars: number) {
  return Math.round(dollars * 100);
}

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function uuidHint() {
  return "Use any UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)";
}

/**
 * Protect real/dev accounts from being deleted by `fresh=1`.
 * Add more emails here anytime you create additional permanent test accounts.
 */
const PROTECTED_USER_EMAILS = new Set<string>([
  "marc+dev@truefantix.local",
]);

/**
 * Seed sellers we "own" and are safe to delete on fresh reseed.
 */
const SEED_SELLER_NAMES = ["Seed Seller", "Seed Buyer"] as const;

/**
 * Allowed placeholder images that you confirmed exist in /public.
 * Seed should ONLY ever store these paths (or /default.jpg fallback).
 */
const ALLOWED_PLACEHOLDER_IMAGES = new Set<string>([
  "/basketball-placeholder.jpg",
  "/comedy-placeholder.jpg",
  "/concert-placeholder.jpg",
  "/conference-placeholder.jpg",
  "/festival-placeholder.jpg",
  "/football-placeholder.jpg",
  "/gala-placeholder.jpg",
  "/hockey-placeholder.jpg",
  "/opera-placeholder.jpg",
  "/sports-placeholder.jpg",
  "/theatre-placeholder.jpg",
  "/workshop-placeholder.jpg",
  "/default.jpg",
]);

function getCategoryFromTitle(title: string): string {
  const t = (title ?? "").trim().toLowerCase();

  const colonIndex = t.indexOf(":");
  if (colonIndex > 0) {
    return t.slice(0, colonIndex).trim();
  }

  if (t.includes("concert")) return "concert";
  if (t.includes("comedy")) return "comedy";
  if (t.includes("hockey")) return "hockey";
  if (t.includes("basketball")) return "basketball";
  if (t.includes("football")) return "football";
  if (t.includes("theatre") || t.includes("theater")) return "theatre";
  if (t.includes("opera")) return "opera";
  if (t.includes("festival")) return "festival";
  if (t.includes("conference")) return "conference";
  if (t.includes("workshop")) return "workshop";
  if (t.includes("gala")) return "gala";
  if (t.includes("sports")) return "sports";

  return "default";
}

function getPlaceholderImageForCategory(category: string): string {
  const c = (category ?? "").trim().toLowerCase();

  const map: Record<string, string> = {
    concert: "/concert-placeholder.jpg",
    comedy: "/comedy-placeholder.jpg",
    hockey: "/hockey-placeholder.jpg",
    basketball: "/basketball-placeholder.jpg",
    football: "/football-placeholder.jpg",
    theatre: "/theatre-placeholder.jpg",
    theater: "/theatre-placeholder.jpg",
    opera: "/opera-placeholder.jpg",
    festival: "/festival-placeholder.jpg",
    conference: "/conference-placeholder.jpg",
    workshop: "/workshop-placeholder.jpg",
    gala: "/gala-placeholder.jpg",
    sports: "/sports-placeholder.jpg",
    default: "/default.jpg",
  };

  return map[c] ?? map.default;
}

function safeSeedImagePath(candidate: unknown, fallbackCategoryOrTitle: string): string {
  const candidateStr = typeof candidate === "string" ? candidate.trim() : "";

  // Allow external image URLs (preferred when Brave image search is configured).
  if (candidateStr && (candidateStr.startsWith("https://") || candidateStr.startsWith("http://"))) {
    return candidateStr;
  }

  if (candidateStr && ALLOWED_PLACEHOLDER_IMAGES.has(candidateStr)) return candidateStr;

  const category = getCategoryFromTitle(fallbackCategoryOrTitle);
  const mapped = getPlaceholderImageForCategory(category);
  if (ALLOWED_PLACEHOLDER_IMAGES.has(mapped)) return mapped;

  return "/default.jpg";
}

function curatedSeedImageForTitle(_title: string): string | null {
  // Keep seeding fully automated via getTicketImage() logic in imageSearch.ts
  // (deterministic team/artist sources + Brave fallback).
  return null;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const fresh = url.searchParams.get("fresh") === "1";

    if (fresh) {
      // 1) Identify seed sellers first (so we can clean badges/metrics safely)
      const seedSellers = await prisma.seller.findMany({
        where: { name: { in: [...SEED_SELLER_NAMES] } },
        select: { id: true },
      });
      const seedSellerIds = seedSellers.map((s: any) => s.id);

      // 2) FK-safe deletion order (broad cleanup)
      // NOTE: We keep USERS (protected ones) and avoid wiping ALL sellers.
      await prisma.payment.deleteMany({}).catch(() => {});
      await prisma.payout.deleteMany({}).catch(() => {});
      await prisma.creditTransaction.deleteMany({}).catch(() => {});
      await prisma.order.deleteMany({}).catch(() => {});
      await prisma.ticket.deleteMany({}).catch(() => {});
      await prisma.event.deleteMany({}).catch(() => {});

      // If forum tables exist, it's safe to reset them too (optional)
      await prisma.forumPost?.deleteMany?.({}).catch(() => {});
      await prisma.forumThread?.deleteMany?.({}).catch(() => {});

      // Seller-related cleanup ONLY for our seed sellers
      if (seedSellerIds.length) {
        await prisma.sellerMetrics.deleteMany({ where: { sellerId: { in: seedSellerIds } } }).catch(() => {});
        await prisma.sellerBadge.deleteMany({ where: { sellerId: { in: seedSellerIds } } }).catch(() => {});
      } else {
        await prisma.sellerMetrics.deleteMany({}).catch(() => {});
        await prisma.sellerBadge.deleteMany({}).catch(() => {});
      }

      await prisma.seller.deleteMany({ where: { name: { in: [...SEED_SELLER_NAMES] } } }).catch(() => {});

      // Users: delete everything EXCEPT protected dev accounts
      const protectedEmails = Array.from(PROTECTED_USER_EMAILS);
      await prisma.user
        .deleteMany({
          where: {
            email: {
              notIn: protectedEmails,
            },
          },
        })
        .catch(() => {});
    }

    // ---
    // Seed Events (40+ tickets; real-ish names; mixed types; mixed price points)
    // ---
    type SeedEventType =
      | "concert"
      | "comedy"
      | "theatre"
      | "festival"
      | "conference"
      | "workshop"
      | "sports-hockey"
      | "sports-basketball"
      | "sports-baseball"
      | "sports-football"
      | "sports-soccer"
      | "sports-other";

    type SeedTicket = {
      title: string;
      date: string;
      venue: string;
      eventType: SeedEventType;
      selloutStatus: "SOLD_OUT" | "NOT_SOLD_OUT";
      faceValueDollars: number;
      priceDollars: number;
      row: string;
      seat: string;
      eventId: string;
    };

    type SeedEvent = {
      title: string;
      date: string;
      venue: string;
      eventType: SeedEventType;
      selloutStatus: "SOLD_OUT" | "NOT_SOLD_OUT";
      faceValueDollars: number;
    };

    // Real-world events (US + Canada, 2026) used as seed sources.
    const seedEvents: SeedEvent[] = [
      // Sports (major leagues)
      { title: "Toronto Maple Leafs vs Montreal Canadiens", date: "2026-01-24", venue: "Scotiabank Arena, Toronto", eventType: "sports-hockey", selloutStatus: "SOLD_OUT", faceValueDollars: 240 },
      { title: "Toronto Maple Leafs vs Boston Bruins", date: "2026-03-21", venue: "Scotiabank Arena, Toronto", eventType: "sports-hockey", selloutStatus: "SOLD_OUT", faceValueDollars: 225 },
      { title: "Toronto Raptors vs New York Knicks", date: "2026-03-06", venue: "Scotiabank Arena, Toronto", eventType: "sports-basketball", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 140 },
      { title: "Toronto Raptors vs Los Angeles Lakers", date: "2026-02-27", venue: "Scotiabank Arena, Toronto", eventType: "sports-basketball", selloutStatus: "SOLD_OUT", faceValueDollars: 190 },
      { title: "Toronto Blue Jays vs New York Yankees", date: "2026-04-03", venue: "Rogers Centre, Toronto", eventType: "sports-baseball", selloutStatus: "SOLD_OUT", faceValueDollars: 95 },
      { title: "Toronto Blue Jays vs Boston Red Sox", date: "2026-04-17", venue: "Rogers Centre, Toronto", eventType: "sports-baseball", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 75 },
      { title: "Toronto FC vs Inter Miami CF", date: "2026-06-14", venue: "BMO Field, Toronto", eventType: "sports-soccer", selloutStatus: "SOLD_OUT", faceValueDollars: 120 },
      { title: "Toronto FC vs CF Montréal", date: "2026-05-23", venue: "BMO Field, Toronto", eventType: "sports-soccer", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 68 },
      { title: "Buffalo Bills vs Miami Dolphins", date: "2026-10-18", venue: "Highmark Stadium, Orchard Park", eventType: "sports-football", selloutStatus: "SOLD_OUT", faceValueDollars: 210 },
      { title: "Seattle Kraken vs Vancouver Canucks", date: "2026-02-12", venue: "Climate Pledge Arena, Seattle", eventType: "sports-hockey", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 145 },
      { title: "Chicago Bulls vs Boston Celtics", date: "2026-01-30", venue: "United Center, Chicago", eventType: "sports-basketball", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 135 },
      { title: "LA Dodgers vs San Diego Padres", date: "2026-07-10", venue: "Dodger Stadium, Los Angeles", eventType: "sports-baseball", selloutStatus: "SOLD_OUT", faceValueDollars: 110 },

      // Theatre / stage
      { title: "Hamilton (Broadway)", date: "2026-03-20", venue: "Richard Rodgers Theatre, New York", eventType: "theatre", selloutStatus: "SOLD_OUT", faceValueDollars: 199 },
      { title: "The Lion King (Broadway)", date: "2026-04-09", venue: "Minskoff Theatre, New York", eventType: "theatre", selloutStatus: "SOLD_OUT", faceValueDollars: 179 },
      { title: "Wicked (Broadway)", date: "2026-05-15", venue: "Gershwin Theatre, New York", eventType: "theatre", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 169 },
      { title: "Moulin Rouge! The Musical", date: "2026-06-06", venue: "Al Hirschfeld Theatre, New York", eventType: "theatre", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 165 },

      // Comedy
      { title: "Just For Laughs Montreal Gala", date: "2026-07-24", venue: "Place des Arts, Montréal", eventType: "comedy", selloutStatus: "SOLD_OUT", faceValueDollars: 120 },
      { title: "JFL Toronto Showcase", date: "2026-09-26", venue: "Meridian Hall, Toronto", eventType: "comedy", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 85 },
      { title: "New York Comedy Festival Headliner Night", date: "2026-11-08", venue: "Beacon Theatre, New York", eventType: "comedy", selloutStatus: "SOLD_OUT", faceValueDollars: 110 },
      { title: "Netflix Is A Joke Festival Showcase", date: "2026-05-10", venue: "Hollywood Palladium, Los Angeles", eventType: "comedy", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 95 },

      // Concerts / music events
      { title: "Osheaga Music and Arts Festival — Day 1", date: "2026-07-31", venue: "Parc Jean-Drapeau, Montréal", eventType: "festival", selloutStatus: "SOLD_OUT", faceValueDollars: 210 },
      { title: "Lollapalooza Chicago — Day Pass", date: "2026-08-01", venue: "Grant Park, Chicago", eventType: "festival", selloutStatus: "SOLD_OUT", faceValueDollars: 225 },
      { title: "Austin City Limits Music Festival — Weekend 1", date: "2026-10-02", venue: "Zilker Park, Austin", eventType: "festival", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 199 },
      { title: "Calgary Stampede — Evening Show", date: "2026-07-10", venue: "Scotiabank Saddledome, Calgary", eventType: "festival", selloutStatus: "SOLD_OUT", faceValueDollars: 89 },
      { title: "Toronto International Film Festival Gala", date: "2026-09-10", venue: "TIFF Bell Lightbox, Toronto", eventType: "festival", selloutStatus: "SOLD_OUT", faceValueDollars: 95 },
      { title: "Montreal International Jazz Festival Headliner", date: "2026-06-30", venue: "Place des Festivals, Montréal", eventType: "festival", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 79 },

      // Conferences / workshops
      { title: "Collision Conference — Day Pass", date: "2026-06-22", venue: "Enercare Centre, Toronto", eventType: "conference", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 399 },
      { title: "SXSW Conference + Festivals Badge", date: "2026-03-13", venue: "Austin Convention Center, Austin", eventType: "conference", selloutStatus: "SOLD_OUT", faceValueDollars: 995 },
      { title: "CES 2026 — Conference Pass", date: "2026-01-07", venue: "Las Vegas Convention Center, Las Vegas", eventType: "conference", selloutStatus: "SOLD_OUT", faceValueDollars: 799 },
      { title: "Toronto Data Workshop Summit", date: "2026-05-02", venue: "Metro Toronto Convention Centre, Toronto", eventType: "workshop", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 249 },
      { title: "Vancouver Product Leadership Workshop", date: "2026-04-18", venue: "Vancouver Convention Centre, Vancouver", eventType: "workshop", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 220 },
      { title: "Montreal AI Practitioner Workshop", date: "2026-09-19", venue: "Palais des congrès de Montréal, Montréal", eventType: "workshop", selloutStatus: "SOLD_OUT", faceValueDollars: 275 },
      { title: "Calgary DevOps Hands-on Workshop", date: "2026-10-03", venue: "Calgary TELUS Convention Centre, Calgary", eventType: "workshop", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 199 },
      { title: "Edmonton Startup Operations Workshop", date: "2026-11-14", venue: "Edmonton Convention Centre, Edmonton", eventType: "workshop", selloutStatus: "NOT_SOLD_OUT", faceValueDollars: 175 },
      { title: "Ottawa Cybersecurity Workshop", date: "2026-02-21", venue: "Shaw Centre, Ottawa", eventType: "workshop", selloutStatus: "SOLD_OUT", faceValueDollars: 260 },
    ];

    // Build 100 ticket listings from real events, varying only seat/row and price.
    const seatRows = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T"];
    const seatNums = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "18", "20", "22", "24"];

    const seedTickets: SeedTicket[] = [];
    let idx = 0;
    while (seedTickets.length < 100) {
      const ev = seedEvents[idx % seedEvents.length];
      const n = seedTickets.length + 1;
      const row = seatRows[n % seatRows.length];
      const seat = seatNums[(n * 3) % seatNums.length];
      const offset = (n % 5) * 5;
      const price = ev.selloutStatus === "SOLD_OUT"
        ? Math.max(20, ev.faceValueDollars - (n % 2) * 0)
        : Math.max(20, ev.faceValueDollars - offset);

      seedTickets.push({
        title: ev.title,
        date: ev.date,
        venue: ev.venue,
        eventType: ev.eventType,
        selloutStatus: ev.selloutStatus,
        faceValueDollars: ev.faceValueDollars,
        priceDollars: price,
        row,
        seat,
        eventId: `seed-event-${String((idx % seedEvents.length) + 1).padStart(3, "0")}`,
      });
      idx += 1;
    }

    // Upsert one event per unique title/date/venue source
    for (let i = 0; i < seedEvents.length; i++) {
      const ev = seedEvents[i];
      const eventId = `seed-event-${String(i + 1).padStart(3, "0")}`;

      await prisma.event.upsert({
        where: { id: eventId },
        create: {
          id: eventId,
          title: ev.title,
          venue: ev.venue,
          date: ev.date,
          selloutStatus: ev.selloutStatus,
        },
        update: {
          title: ev.title,
          venue: ev.venue,
          date: ev.date,
          selloutStatus: ev.selloutStatus,
        },
      });
    }

    // Seller who LISTS tickets
    let seedSeller = await prisma.seller.findFirst({
      where: { name: "Seed Seller" },
      include: { badges: true },
    });

    if (!seedSeller) {
      seedSeller = await prisma.seller.create({
        data: {
          name: "Seed Seller",
          rating: 4.8,
          reviews: 120,
          creditBalanceCredits: 0,
        },
        include: { badges: true },
      });
    } else {
      seedSeller = await prisma.seller.update({
        where: { id: seedSeller.id },
        data: { rating: 4.8, reviews: 120 },
        include: { badges: true },
      });
    }

    // Ensure Verified badge for seller
    if (!(seedSeller.badges ?? []).some((b: any) => b.name === "Verified")) {
      await prisma.sellerBadge.create({
        data: { sellerId: seedSeller.id, name: "Verified" },
      });
    }

    // Buyer "Seller profile" (so we have a buyerSellerId for purchases)
    let seedBuyer = await prisma.seller.findFirst({
      where: { name: "Seed Buyer" },
      include: { badges: true },
    });

    if (!seedBuyer) {
      seedBuyer = await prisma.seller.create({
        data: {
          name: "Seed Buyer",
          rating: 4.9,
          reviews: 12,
          creditBalanceCredits: 1,
        },
        include: { badges: true },
      });
    } else {
      seedBuyer = await prisma.seller.update({
        where: { id: seedBuyer.id },
        data: { creditBalanceCredits: 1 },
        include: { badges: true },
      });
    }

    const createdTickets: Array<{ id: string; title: string; status: string; priceCents: number }> = [];

    for (const t of seedTickets) {
      const existing = await prisma.ticket.findFirst({
        where: { title: t.title, sellerId: seedSeller.id, row: t.row, seat: t.seat },
        select: { id: true, status: true },
      });

      if (existing) continue;

      // Prefer curated internet images for known artists/teams/shows, then Brave image search,
      // then placeholder fallback.
      const curated = curatedSeedImageForTitle(t.title);
      const imageUrl = curated ?? (await getTicketImage(t.title, t.eventType));

      const created = await prisma.ticket.create({
        data: {
          title: t.title,
          date: t.date,
          venue: t.venue,
          row: t.row,
          seat: t.seat,
          image: safeSeedImagePath(imageUrl, t.title),
          priceCents: dollarsToCents(t.priceDollars),
          faceValueCents: dollarsToCents(t.faceValueDollars),
          status: "AVAILABLE",
          // Important: public ticket listing defaults to returning VERIFIED tickets only.
          // Seeded tickets should be immediately visible in the marketplace.
          verificationStatus: "VERIFIED",
          verifiedAt: new Date(),
          sellerId: seedSeller.id,
          // Note: omit eventId to avoid FK complexity during seed; tickets remain valid without event linkage.
        },
        select: { id: true, title: true, status: true, priceCents: true },
      });

      createdTickets.push(created);
    }

    // Also ensure ONE withdrawn ticket exists
    const withdrawnTitle = "Withdrawn: Seed Ticket (Testing)";
    const existingWithdrawn = await prisma.ticket.findFirst({
      where: { title: withdrawnTitle, sellerId: seedSeller.id },
      select: { id: true },
    });

    if (!existingWithdrawn) {
      await prisma.ticket.create({
        data: {
          title: withdrawnTitle,
          date: "May 1, 2026",
          venue: "Seed Venue",
          image: safeSeedImagePath(null, withdrawnTitle),
          priceCents: dollarsToCents(60),
          faceValueCents: dollarsToCents(60),
          status: "WITHDRAWN",
          verificationStatus: "VERIFIED",
          verifiedAt: new Date(),
          withdrawnAt: new Date(),
          sellerId: seedSeller.id,
        },
      });
    }

    // Ensure seeded tickets are visible in public listings (which default to VERIFIED only).
    // Even if the DB has defaults/triggers, force the seed set to VERIFIED.
    // Some environments have seen seeded tickets persist as PENDING (likely due to older rows,
    // differing titles, or unexpected DB defaults). Force ALL Seed Seller tickets to VERIFIED.
    await prisma.ticket.updateMany({
      where: {
        sellerId: seedSeller.id,
        status: { in: ["AVAILABLE", "WITHDRAWN", "SOLD"] },
      },
      data: { verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });

    // Reload for response
    const sellerOut = await prisma.seller.findUnique({
      where: { id: seedSeller.id },
      include: { badges: true },
    });

    const buyerOut = await prisma.seller.findUnique({
      where: { id: seedBuyer.id },
      include: { badges: true },
    });

    return NextResponse.json({
      ok: true,
      message: fresh
        ? `Seeded fresh data (kept protected users: ${Array.from(PROTECTED_USER_EMAILS).join(", ")})`
        : "Seeded data (without wiping).",
      seller: sellerOut
        ? {
            sellerId: sellerOut.id,
            name: sellerOut.name,
            creditBalanceCredits: sellerOut.creditBalanceCredits,
            badges: sellerOut.badges.map((b: any) => b.name),
          }
        : null,
      buyer: buyerOut
        ? {
            buyerSellerId: buyerOut.id,
            name: buyerOut.name,
            creditBalanceCredits: buyerOut.creditBalanceCredits,
            badges: buyerOut.badges.map((b: any) => b.name),
          }
        : null,
      createdTickets: createdTickets.map((t: any) => ({
        ticketId: t.id,
        title: t.title,
        status: t.status,
        priceCents: t.priceCents,
        price: centsToDollars(t.priceCents),
        purchaseUrl: `/api/tickets/${t.id}/purchase`,
      })),
      tips: {
        listTickets: "/api/tickets",
        listTicketsDebug: "/api/tickets?debug=1",
        listWithdrawn: "/api/tickets?status=WITHDRAWN",
        purchaseFormat:
          "/api/tickets/<TICKET_ID>/purchase?buyerSellerId=<BUYER_SELLER_ID> + header Idempotency-Key: <uuid>",
        idempotencyKeyHint: uuidHint(),
        exampleCurl:
          buyerOut && createdTickets[0]
            ? `curl -X POST "http://localhost:3000/api/tickets/${createdTickets[0].id}/purchase?buyerSellerId=${buyerOut.id}" -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000"`
            : null,
        rerunFresh: "/api/debug/seed?fresh=1 (POST)",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: "Seed failed", details: message }, { status: 500 });
  }
}
