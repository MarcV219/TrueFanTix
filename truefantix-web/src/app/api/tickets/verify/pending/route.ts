export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { autoVerifyTicketById } from "@/lib/tickets/verification";
import { schemas, validateOptionalRequest } from "@/lib/validation";

function hasInternalCronAuth(req: Request) {
  const configured = process.env.TICKET_VERIFY_CRON_KEY?.trim();
  if (!configured) return false;
  const provided = req.headers.get("x-ticket-verify-key")?.trim();
  return !!provided && provided === configured;
}

export async function POST(req: Request) {
  const internalCron = hasInternalCronAuth(req);
  if (!internalCron) {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;
  }

  const validation = await validateOptionalRequest(schemas.ticketVerifyPending)(req);
  if (!validation.success) return validation.response;

  const take = validation.data.take;

  const pending = await prisma.ticket.findMany({
    where: { verificationStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true },
  });

  const processed: any[] = [];

  for (const t of pending) {
    const updated = await autoVerifyTicketById(prisma, t.id);
    if (updated) processed.push(updated);
  }

  return NextResponse.json({
    ok: true,
    triggeredBy: internalCron ? "cron-key" : "admin-session",
    requested: take,
    processedCount: processed.length,
    processed,
  });
}
