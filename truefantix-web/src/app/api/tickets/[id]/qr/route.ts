export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseTicketIdFromUrl(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ticketsIndex = parts.indexOf("tickets");
  if (ticketsIndex !== -1 && parts.length > ticketsIndex + 1) {
    return normalizeId(parts[ticketsIndex + 1]);
  }
  return "";
}

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const ticketId = parseTicketIdFromUrl(req);
    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Ticket ID is required." },
        { status: 400 }
      );
    }

    // Get ticket with order info
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        orderItems: {
          include: {
            order: true,
          },
        },
        seller: {
          select: { name: true },
        },
        event: true,
      },
    });

    if (!ticket) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Ticket not found." },
        { status: 404 }
      );
    }

    // Verify user owns this ticket (as buyer)
    const orderItem = ticket.orderItems.find(
      (item) => item.order.buyerSellerId === gate.user.sellerId
    );

    if (!orderItem) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "You do not have access to this ticket." },
        { status: 403 }
      );
    }

    // Only allow QR generation for SOLD tickets
    if (ticket.status !== "SOLD") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", message: "Ticket is not yet available for download." },
        { status: 400 }
      );
    }

    // Generate QR code data
    const qrData = JSON.stringify({
      ticketId: ticket.id,
      orderId: orderItem.order.id,
      title: ticket.title,
      venue: ticket.venue,
      date: ticket.date,
      buyerId: gate.user.id,
      timestamp: Date.now(),
    });

    // Generate QR code
    const QRCode = await import("qrcode");
    const qrBuffer = await QRCode.toBuffer(qrData, {
      type: "png",
      width: 400,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    return new Response(qrBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
      },
    });

  } catch (err: any) {
    console.error("GET /api/tickets/[id]/qr error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to generate QR code." },
      { status: 500 }
    );
  }
}
