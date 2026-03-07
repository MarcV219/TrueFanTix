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

function curatedSeedImageForTitle(title: string): string | null {
  const t = title.toLowerCase();

  // Deterministic internet images using seeded keyword queries.
  // These are not placeholders and are stable per event key.
  if (t.includes("taylor swift")) return "https://loremflickr.com/640/480/taylor,swift,concert?lock=101";
  if (t.includes("drake")) return "https://loremflickr.com/640/480/drake,concert,stage?lock=102";
  if (t.includes("the weeknd")) return "https://loremflickr.com/640/480/weeknd,concert,stage?lock=103";
  if (t.includes("ed sheeran")) return "https://loremflickr.com/640/480/ed,sheeran,concert?lock=104";

  if (t.includes("maple leafs")) return "https://loremflickr.com/640/480/hockey,toronto,arena?lock=201";
  if (t.includes("raptors")) return "https://loremflickr.com/640/480/basketball,toronto,raptors?lock=202";
  if (t.includes("blue jays")) return "https://loremflickr.com/640/480/baseball,toronto,blue,jays?lock=203";
  if (t.includes("toronto fc")) return "https://loremflickr.com/640/480/soccer,toronto,stadium?lock=204";

  if (t.includes("hamilton")) return "https://loremflickr.com/640/480/theatre,musical,stage?lock=301";
  if (t.includes("lion king")) return "https://loremflickr.com/640/480/theatre,musical,lion,king?lock=302";
  if (t.includes("dave chappelle")) return "https://loremflickr.com/640/480/comedy,standup,microphone?lock=303";
  if (t.includes("john mulaney")) return "https://loremflickr.com/640/480/comedy,standup,stage?lock=304";
  if (t.includes("tiff")) return "https://loremflickr.com/640/480/film,festival,red,carpet?lock=401";
  if (t.includes("collision conference")) return "https://loremflickr.com/640/480/conference,technology,stage?lock=402";

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
    };

    const seedTickets: SeedTicket[] = [
      // Concerts
      {
        title: "Taylor Swift — The Eras Tour",
        date: "Apr 18, 2026",
        venue: "Rogers Centre (Toronto)",
        eventType: "concert",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 299,
        priceDollars: 299,
        row: "A",
        seat: "12",
      },
      {
        title: "Drake — It's All a Blur Tour",
        date: "May 5, 2026",
        venue: "Scotiabank Arena (Toronto)",
        eventType: "concert",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 220,
        priceDollars: 179,
        row: "104",
        seat: "8",
      },
      {
        title: "The Weeknd — After Hours Til Dawn",
        date: "Jun 2, 2026",
        venue: "Rogers Centre (Toronto)",
        eventType: "concert",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 185,
        priceDollars: 185,
        row: "B",
        seat: "22",
      },
      {
        title: "Ed Sheeran — Mathematics Tour",
        date: "Jul 11, 2026",
        venue: "Rogers Centre (Toronto)",
        eventType: "concert",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 160,
        priceDollars: 129,
        row: "126",
        seat: "14",
      },

      // Hockey
      {
        title: "Toronto Maple Leafs vs Montreal Canadiens",
        date: "Mar 14, 2026",
        venue: "Scotiabank Arena (Toronto)",
        eventType: "sports-hockey",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 240,
        priceDollars: 240,
        row: "12",
        seat: "5",
      },
      {
        title: "Toronto Maple Leafs vs Boston Bruins",
        date: "Mar 28, 2026",
        venue: "Scotiabank Arena (Toronto)",
        eventType: "sports-hockey",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 210,
        priceDollars: 175,
        row: "18",
        seat: "11",
      },

      // Basketball
      {
        title: "Toronto Raptors vs Los Angeles Lakers",
        date: "Feb 27, 2026",
        venue: "Scotiabank Arena (Toronto)",
        eventType: "sports-basketball",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 190,
        priceDollars: 190,
        row: "109",
        seat: "7",
      },
      {
        title: "Toronto Raptors vs New York Knicks",
        date: "Mar 6, 2026",
        venue: "Scotiabank Arena (Toronto)",
        eventType: "sports-basketball",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 140,
        priceDollars: 99,
        row: "321",
        seat: "3",
      },

      // Baseball
      {
        title: "Toronto Blue Jays vs New York Yankees",
        date: "Apr 3, 2026",
        venue: "Rogers Centre (Toronto)",
        eventType: "sports-baseball",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 95,
        priceDollars: 95,
        row: "128",
        seat: "9",
      },
      {
        title: "Toronto Blue Jays vs Boston Red Sox",
        date: "Apr 17, 2026",
        venue: "Rogers Centre (Toronto)",
        eventType: "sports-baseball",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 75,
        priceDollars: 59,
        row: "240",
        seat: "16",
      },

      // Soccer
      {
        title: "Toronto FC vs CF Montréal",
        date: "May 21, 2026",
        venue: "BMO Field (Toronto)",
        eventType: "sports-soccer",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 65,
        priceDollars: 55,
        row: "15",
        seat: "18",
      },
      {
        title: "Toronto FC vs Inter Miami",
        date: "Jun 9, 2026",
        venue: "BMO Field (Toronto)",
        eventType: "sports-soccer",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 120,
        priceDollars: 120,
        row: "110",
        seat: "6",
      },

      // Theatre
      {
        title: "Hamilton (Musical)",
        date: "Mar 20, 2026",
        venue: "Princess of Wales Theatre (Toronto)",
        eventType: "theatre",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 180,
        priceDollars: 180,
        row: "C",
        seat: "19",
      },
      {
        title: "The Lion King (Musical)",
        date: "Apr 9, 2026",
        venue: "Ed Mirvish Theatre (Toronto)",
        eventType: "theatre",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 155,
        priceDollars: 129,
        row: "F",
        seat: "4",
      },

      // Comedy
      {
        title: "Dave Chappelle — Live",
        date: "May 30, 2026",
        venue: "Meridian Hall (Toronto)",
        eventType: "comedy",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 150,
        priceDollars: 150,
        row: "D",
        seat: "10",
      },
      {
        title: "John Mulaney — Standup",
        date: "Jun 14, 2026",
        venue: "Massey Hall (Toronto)",
        eventType: "comedy",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 120,
        priceDollars: 89,
        row: "E",
        seat: "7",
      },

      // Festival / Conference
      {
        title: "Toronto International Film Festival (TIFF) — Gala",
        date: "Sep 10, 2026",
        venue: "TIFF Bell Lightbox (Toronto)",
        eventType: "festival",
        selloutStatus: "SOLD_OUT",
        faceValueDollars: 95,
        priceDollars: 95,
        row: "GA",
        seat: "GA",
      },
      {
        title: "Collision Conference — Day Pass",
        date: "Jun 22, 2026",
        venue: "Enercare Centre (Toronto)",
        eventType: "conference",
        selloutStatus: "NOT_SOLD_OUT",
        faceValueDollars: 399,
        priceDollars: 249,
        row: "GA",
        seat: "GA",
      },
    ];

    // Expand to ~40 by cloning patterns with slight variations.
    // (Keeping deterministic output: same titles each time.)
    while (seedTickets.length < 40) {
      const n = seedTickets.length + 1;
      const template = seedTickets[(n - 1) % 16];
      seedTickets.push({
        ...template,
        title: `${template.title} (Alt ${n})`,
        // small price variety
        priceDollars: Math.max(25, template.priceDollars - (n % 4) * 10),
        faceValueDollars: template.faceValueDollars,
        row: template.row === "GA" ? "GA" : String((Number(template.row) || (n % 20) + 1)),
        seat: template.seat === "GA" ? "GA" : String(((Number(template.seat) || 1) + (n % 12)) % 28 + 1),
        selloutStatus: n % 3 === 0 ? "SOLD_OUT" : "NOT_SOLD_OUT",
      });
    }

    // Upsert events for each ticket (stable seed IDs)
    const eventIdByTitle = new Map<string, string>();
    for (let i = 0; i < seedTickets.length; i++) {
      const t = seedTickets[i];
      const eventId = `seed-event-${String(i + 1).padStart(2, "0")}`;
      eventIdByTitle.set(t.title, eventId);

      await prisma.event.upsert({
        where: { id: eventId },
        create: {
          id: eventId,
          title: t.title,
          venue: t.venue,
          date: t.date,
          selloutStatus: t.selloutStatus,
        },
        update: {
          title: t.title,
          venue: t.venue,
          date: t.date,
          selloutStatus: t.selloutStatus,
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
        where: { title: t.title, sellerId: seedSeller.id },
        select: { id: true, status: true },
      });

      if (existing) continue;

      const eventId = eventIdByTitle.get(t.title) ?? null;

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
          eventId,
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
          eventId: "seed-event-01", // any stable seed event id is fine for withdrawn test ticket
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
