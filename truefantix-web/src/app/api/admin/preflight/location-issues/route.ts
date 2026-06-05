export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { getTaxRateForVenue } from "@/lib/tax-rates";

function venueForTicket(ticket: { venue: string; event?: { venue: string | null } | null }) {
  return ticket.event?.venue || ticket.venue || "";
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 100), 1), 200);

  const [tickets, ordersWithNoTaxRegion] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        status: { in: ["AVAILABLE", "RESERVED"] },
        withdrawnAt: null,
        soldAt: null,
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        title: true,
        venue: true,
        date: true,
        status: true,
        priceCents: true,
        faceValueCents: true,
        createdAt: true,
        seller: { select: { id: true, name: true } },
        event: { select: { id: true, title: true, venue: true, date: true } },
      },
    }),
    prisma.order.findMany({
      where: {
        status: { in: ["PAID", "DELIVERED", "COMPLETED"] },
        adminFeeCents: { gt: 0 },
        adminFeeTaxCents: 0,
        OR: [{ taxRegionCode: null }, { taxRegionCode: "" }, { taxRateBps: 0 }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        createdAt: true,
        amountCents: true,
        adminFeeCents: true,
        adminFeeTaxCents: true,
        taxRateBps: true,
        taxRegionCode: true,
        taxCountryCode: true,
        taxLabel: true,
        totalCents: true,
        items: {
          take: 1,
          select: {
            ticket: { select: { title: true, venue: true, date: true } },
          },
        },
      },
    }),
  ]);

  const ticketRows = tickets.map((ticket) => {
    const venue = venueForTicket(ticket);
    const taxRate = getTaxRateForVenue(venue);
    return {
      id: ticket.id,
      title: ticket.title,
      venue,
      ticketVenue: ticket.venue,
      eventVenue: ticket.event?.venue ?? null,
      date: ticket.event?.date || ticket.date,
      status: ticket.status,
      priceCents: ticket.priceCents,
      faceValueCents: ticket.faceValueCents,
      createdAt: ticket.createdAt.toISOString(),
      seller: ticket.seller,
      resolvedTax: taxRate,
      issue: taxRate ? null : "NO_STATE_OR_PROVINCE_RESOLVED",
    };
  });

  const unresolvedTickets = ticketRows.filter((ticket) => !ticket.resolvedTax);

  return NextResponse.json({
    ok: true,
    scanned: {
      tickets: ticketRows.length,
      paidOrdersWithAdminFee: ordersWithNoTaxRegion.length,
    },
    counts: {
      unresolvedTickets: unresolvedTickets.length,
      ordersWithNoTaxRegion: ordersWithNoTaxRegion.length,
    },
    unresolvedTickets,
    ordersWithNoTaxRegion: ordersWithNoTaxRegion.map((order) => ({
      ...order,
      ticket: order.items[0]?.ticket ?? null,
      items: undefined,
    })),
  });
}
