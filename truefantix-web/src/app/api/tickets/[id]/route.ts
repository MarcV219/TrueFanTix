export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseTicketIdFromUrl(req: Request): string {
  // /api/tickets/<id>
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ticketsIndex = parts.indexOf("tickets");
  if (ticketsIndex !== -1 && parts.length > ticketsIndex + 1) {
    return normalizeId(parts[ticketsIndex + 1]);
  }
  return "";
}

export async function GET(req: Request) {
  try {
    const ticketId = parseTicketIdFromUrl(req);

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: true,
        seller: { include: { badges: true } },
      },
    });

    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      ticket: {
        ...ticket,
        seller: ticket.seller
          ? { ...ticket.seller, badges: ticket.seller.badges.map((b: any) => b.name) }
          : null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Ticket lookup failed", details: message },
      { status: 500 }
    );
  }
}

/**
 * Withdraw (soft-remove) an unsold ticket.
 * Call: DELETE /api/tickets/<TICKET_ID>?sellerId=<SELLER_ID>
 *
 * Rules:
 * - Seller can withdraw only their own ticket.
 * - Cannot withdraw SOLD.
 * - Cannot withdraw during an active reservation window.
 * - If RESERVED but expired, allow withdraw and clear reservation fields.
 * - AVAILABLE is withdrawable.
 */
export async function DELETE(req: Request) {
  try {
    const ticketId = parseTicketIdFromUrl(req);
    const url = new URL(req.url);
    const sellerId = normalizeId(url.searchParams.get("sellerId"));

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    if (!sellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing sellerId",
          hint: "Use DELETE /api/tickets/<TICKET_ID>?sellerId=<SELLER_ID>",
        },
        { status: 400 }
      );
    }

    const now = new Date();

    // Load ticket + reservation fields for guardrails
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        reservedUntil: true,
        reservedByOrderId: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    // Only the listing seller can withdraw
    if (ticket.sellerId !== sellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Not authorized to withdraw this ticket",
          debug: { ticketSellerId: ticket.sellerId, sellerId },
        },
        { status: 403 }
      );
    }

    // Guardrails
    if (ticket.status === "SOLD") {
      return NextResponse.json(
        { ok: false, error: "Cannot withdraw a SOLD ticket" },
        { status: 400 }
      );
    }

    // Block withdraw during an active reservation window
    const isActivelyReserved =
      ticket.status === "RESERVED" &&
      ticket.reservedUntil != null &&
      ticket.reservedUntil > now;

    if (isActivelyReserved) {
      return NextResponse.json(
        {
          ok: false,
          error: "Cannot withdraw: ticket is currently reserved",
          debug: {
            reservedUntil: ticket.reservedUntil,
            reservedByOrderId: ticket.reservedByOrderId,
          },
        },
        { status: 409 }
      );
    }

    // Only AVAILABLE or (RESERVED but expired) can be withdrawn
    if (ticket.status !== "AVAILABLE" && ticket.status !== "RESERVED") {
      return NextResponse.json(
        {
          ok: false,
          error: "Only AVAILABLE tickets can be withdrawn (or RESERVED if expired)",
          debug: { status: ticket.status },
        },
        { status: 400 }
      );
    }

    // Soft withdraw atomically, expiry-aware:
    // - If AVAILABLE: withdraw
    // - If RESERVED but expired: withdraw and clear reservation fields
    const updated = await prisma.ticket.updateMany({
      where: {
        id: ticketId,
        sellerId,
        OR: [
          { status: "AVAILABLE" },
          {
            status: "RESERVED",
            OR: [{ reservedUntil: null }, { reservedUntil: { lte: now } }],
          },
        ],
      },
      data: {
        status: TicketStatus.WITHDRAWN,
        withdrawnAt: new Date(),
        reservedUntil: null,
        reservedByOrderId: null,
      },
    });

    if (updated.count !== 1) {
      return NextResponse.json(
        { ok: false, error: "Ticket could not be withdrawn (status changed or active reservation)" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Ticket withdrawn",
      withdrawnTicketId: ticketId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Withdraw failed", details: message },
      { status: 500 }
    );
  }
}
