export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";

function ticketIdFromRequest(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("tickets");
  return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const ticketId = ticketIdFromRequest(req);
  const body = await req.json().catch(() => null);
  const waived = body?.waived === true;
  const reason = String(body?.reason || "").trim();

  if (!ticketId) {
    return NextResponse.json({ ok: false, error: "MISSING_TICKET_ID" }, { status: 400 });
  }
  if (waived && (reason.length < 3 || reason.length > 500)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_REASON", message: "Enter a waiver reason between 3 and 500 characters." },
      { status: 400 }
    );
  }

  const existing = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, buyerAdminFeeWaived: true },
  });
  if (!existing) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  if (existing.status !== "AVAILABLE") {
    return NextResponse.json(
      { ok: false, error: "FEE_WAIVER_LOCKED", message: "Fee waivers can only be changed while the ticket is available." },
      { status: 409 }
    );
  }

  const now = new Date();
  const ticket = await prisma.ticket.update({
    where: { id: ticketId },
    data: waived
      ? {
          buyerAdminFeeWaived: true,
          buyerAdminFeeWaiverReason: reason,
          buyerAdminFeeWaivedAt: now,
          buyerAdminFeeWaivedByUserId: gate.user.id,
        }
      : {
          buyerAdminFeeWaived: false,
          buyerAdminFeeWaiverReason: null,
          buyerAdminFeeWaivedAt: null,
          buyerAdminFeeWaivedByUserId: null,
        },
    select: {
      id: true,
      buyerAdminFeeWaived: true,
      buyerAdminFeeWaiverReason: true,
      buyerAdminFeeWaivedAt: true,
      buyerAdminFeeWaivedByUserId: true,
    },
  });

  await auditLog({
    action: waived ? "ADMIN_TICKET_FEE_WAIVE" : "ADMIN_TICKET_FEE_WAIVER_REVOKE",
    userId: gate.user.id,
    targetType: "Ticket",
    targetId: ticketId,
    metadata: { previousWaived: existing.buyerAdminFeeWaived, waived, reason: waived ? reason : null },
    ...createAuditContext(req),
  });

  return NextResponse.json({ ok: true, ticket });
}
