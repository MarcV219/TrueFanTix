export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketStatus, TicketEscrowState } from "@prisma/client";
import { requireVerifiedUser } from "@/lib/auth/guards";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  const p: any = ctx?.params;
  const resolved = typeof p?.then === "function" ? await p : p;
  const ticketId = normalizeId(resolved?.id);
  if (!ticketId) return NextResponse.json({ ok: false, error: "Missing ticket id" }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { escrow: true } });
  if (!ticket) return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });

  const isSeller = gate.user.sellerId === ticket.sellerId;
  const isAdmin = gate.user.role === "ADMIN";
  if (!isSeller && !isAdmin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  if (ticket.status !== TicketStatus.AVAILABLE) {
    return NextResponse.json({ ok: false, error: "Ticket must be AVAILABLE for escrow deposit" }, { status: 409 });
  }

  if (ticket.verificationStatus === "REJECTED") {
    return NextResponse.json({ ok: false, error: "Rejected ticket cannot be deposited" }, { status: 409 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}

  const provider = body?.provider ? String(body.provider) : "MANUAL";
  const providerRef = body?.providerRef ? String(body.providerRef) : null;

  const escrow = await prisma.ticketEscrow.upsert({
    where: { ticketId },
    create: {
      ticketId,
      state: TicketEscrowState.IN_ESCROW,
      provider,
      providerRef,
      depositedAt: new Date(),
    },
    update: {
      state: TicketEscrowState.IN_ESCROW,
      provider,
      providerRef,
      failureReason: null,
      depositedAt: new Date(),
      releasedAt: null,
      releasedTo: null,
    },
  });

  return NextResponse.json({ ok: true, escrow });
}
