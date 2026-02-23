export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  if (candidateStr && ALLOWED_PLACEHOLDER_IMAGES.has(candidateStr)) return candidateStr;

  const category = getCategoryFromTitle(fallbackCategoryOrTitle);
  const mapped = getPlaceholderImageForCategory(category);
  if (ALLOWED_PLACEHOLDER_IMAGES.has(mapped)) return mapped;

  return "/default.jpg";
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

    // Events (stable IDs)
    const soldOutEvent = await prisma.event.upsert({
      where: { id: "seed-soldout-event" },
      create: {
        id: "seed-soldout-event",
        title: "Concert: The Seed Band (Sold Out)",
        venue: "Seed Arena",
        date: "Feb 20, 2026",
        selloutStatus: "SOLD_OUT",
      },
      update: {
        title: "Concert: The Seed Band (Sold Out)",
        venue: "Seed Arena",
        date: "Feb 20, 2026",
        selloutStatus: "SOLD_OUT",
      },
    });

    const openEvent = await prisma.event.upsert({
      where: { id: "seed-open-event" },
      create: {
        id: "seed-open-event",
        title: "Sports: Seeds vs Rivals (Not Sold Out)",
        venue: "Stadium Seed",
        date: "Mar 2, 2026",
        selloutStatus: "NOT_SOLD_OUT",
      },
      update: {
        title: "Sports: Seeds vs Rivals (Not Sold Out)",
        venue: "Stadium Seed",
        date: "Mar 2, 2026",
        selloutStatus: "NOT_SOLD_OUT",
      },
    });

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
    if (!(seedSeller.badges ?? []).some((b) => b.name === "Verified")) {
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

    // Tickets to ensure exist (AVAILABLE)
    const seedTickets = [
      {
        title: "Concert: The Seed Band",
        date: "Feb 20, 2026",
        venue: "Seed Arena",
        priceCents: dollarsToCents(110),
        faceValueCents: dollarsToCents(110),
        image: "/concert-placeholder.jpg",
        eventId: soldOutEvent.id,
      },
      {
        title: "Sports: Seeds vs Rivals",
        date: "Mar 2, 2026",
        venue: "Stadium Seed",
        priceCents: dollarsToCents(95),
        faceValueCents: dollarsToCents(95),
        image: "/sports-placeholder.jpg",
        eventId: openEvent.id,
      },
      {
        title: "Theatre: The Seed Play",
        date: "Apr 10, 2026",
        venue: "Downtown Theatre",
        priceCents: dollarsToCents(70),
        faceValueCents: dollarsToCents(70),
        image: "/theatre-placeholder.jpg",
        eventId: openEvent.id,
      },
    ];

    const createdTickets: Array<{ id: string; title: string; status: string; priceCents: number }> = [];

    for (const t of seedTickets) {
      const existing = await prisma.ticket.findFirst({
        where: { title: t.title, sellerId: seedSeller.id },
        select: { id: true, status: true },
      });

      if (existing) continue;

      const created = await prisma.ticket.create({
        data: {
          title: t.title,
          date: t.date,
          venue: t.venue,
          image: safeSeedImagePath(t.image, t.title),
          priceCents: t.priceCents,
          faceValueCents: t.faceValueCents,
          status: "AVAILABLE",
          sellerId: seedSeller.id,
          eventId: t.eventId,
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
          withdrawnAt: new Date(),
          sellerId: seedSeller.id,
          eventId: openEvent.id,
        },
      });
    }

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
