import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/outreach";
import { auditLog, createAuditContext } from "@/lib/audit";
export async function GET(req: Request) { const gate = await requireAdmin(req); if (!gate.ok) return gate.res; return NextResponse.json({ ok: true, items: await prisma.outreachSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 500 }) }); }
export async function POST(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res; const body = await req.json().catch(() => null); const email = normalizeEmail(String(body?.email || ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400 });
  const item = await prisma.outreachSuppression.upsert({ where: { normalizedEmail: email }, create: { email, normalizedEmail: email, reason: String(body?.reason || "MANUAL"), source: "ADMIN", notes: String(body?.notes || "").trim() || null, suppressedById: gate.user.id }, update: { reason: String(body?.reason || "MANUAL"), source: "ADMIN", notes: String(body?.notes || "").trim() || null, suppressedById: gate.user.id } });
  await prisma.outreachContact.updateMany({ where: { normalizedEmail: email }, data: { unsubscribedAt: new Date() } }); await auditLog({ action: "ADMIN_OUTREACH_SUPPRESS", userId: gate.user.id, targetType: "EmailSuppression", targetId: item.id, metadata: { reason: item.reason }, ...createAuditContext(req) }); return NextResponse.json({ ok: true, item });
}
