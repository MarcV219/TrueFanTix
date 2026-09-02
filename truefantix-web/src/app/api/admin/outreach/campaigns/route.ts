import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { contactMergeVars, normalizeEmail } from "@/lib/outreach";
import { renderMerge } from "@/lib/integrations/gmail";
import { auditLog, createAuditContext } from "@/lib/audit";

export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const items = await prisma.outreachCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { recipients: true } }, recipients: { select: { status: true } } } });
  return NextResponse.json({ ok: true, items: items.map(({ recipients, ...item }) => ({ ...item, statusCounts: recipients.reduce((all: Record<string, number>, row) => { all[row.status] = (all[row.status] || 0) + 1; return all; }, {}) })) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => null); const name = String(body?.name || "").trim(); const subject = String(body?.subject || "").trim(); const bodyText = String(body?.bodyText || "").trim();
  const contactIds: string[] = Array.isArray(body?.contactIds) ? Array.from(new Set<string>(body.contactIds.map((value: unknown) => String(value)))).slice(0, 500) : [];
  if (!name || !subject || !bodyText || !contactIds.length) return NextResponse.json({ ok: false, error: "Campaign name, subject, message, and at least one contact are required." }, { status: 400 });
  const contacts = await prisma.outreachContact.findMany({ where: { id: { in: contactIds } } });
  const suppressions = await prisma.outreachSuppression.findMany({ where: { normalizedEmail: { in: contacts.map((x) => x.normalizedEmail).filter(Boolean) as string[] } }, select: { normalizedEmail: true } });
  const blocked = new Set(suppressions.map((x) => x.normalizedEmail)); const used = new Set<string>(); const eligible = contacts.filter((contact) => {
    if (!contact.email || !contact.normalizedEmail || !contact.sourceUrl || contact.unsubscribedAt || contact.consentBasis === "UNASSESSED" || blocked.has(contact.normalizedEmail)) return false;
    const email = normalizeEmail(contact.email); if (used.has(email)) return false; used.add(email); return true;
  });
  if (!eligible.length) return NextResponse.json({ ok: false, error: "No selected contacts are currently sendable. Record a valid contact basis and source, and ensure the address is not suppressed." }, { status: 400 });
  const campaign = await prisma.outreachCampaign.create({ data: { name, subject, bodyText, bodyHtml: null, createdById: gate.user.id, templateId: body?.templateId || null, recipients: { create: eligible.map((contact) => { const vars = contactMergeVars(contact); return { contactId: contact.id, emailSnapshot: contact.email!, subjectSnapshot: renderMerge(subject, vars), bodyTextSnapshot: renderMerge(bodyText, vars), status: "PENDING" }; }) } }, include: { _count: { select: { recipients: true } } } });
  await auditLog({ action: "ADMIN_OUTREACH_CAMPAIGN_CREATE", userId: gate.user.id, targetType: "OutreachCampaign", targetId: campaign.id, metadata: { recipientCount: campaign._count.recipients, skipped: contactIds.length - eligible.length }, ...createAuditContext(req) });
  return NextResponse.json({ ok: true, item: campaign, skipped: contactIds.length - eligible.length }, { status: 201 });
}
