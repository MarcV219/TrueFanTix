import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { contactMergeVars, normalizeEmail, recentContactCutoff, renderMerge } from "@/lib/outreach";
import { outreachHtmlToText, sanitizeOutreachHtml } from "@/lib/outreach-rich-text";
import { auditLog, createAuditContext } from "@/lib/audit";
import { MAX_OUTREACH_CAMPAIGN_CONTACTS as MAX_CAMPAIGN_CONTACTS } from "@/lib/outreach-config";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: {
      id: true, name: true, status: true, subject: true, bodyText: true,
      bodyHtml: true, allowRecentContact: true,
      recipients: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          contactId: true,
          emailSnapshot: true,
          subjectSnapshot: true,
          bodyTextSnapshot: true,
          bodyHtmlSnapshot: true,
          status: true,
          error: true,
          events: {
            orderBy: { occurredAt: "desc" },
            select: {
              id: true,
              type: true,
              occurredAt: true,
              detail: true,
            },
          },
          contact: {
            select: {
              contactName: true,
              organization: true,
              subjectName: true,
              role: true,
            },
          },
        },
      },
    },
  });
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  return NextResponse.json({ ok: true, item: campaign });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const name = String(body?.name || "").trim();
  const subject = String(body?.subject || "").trim();
  const bodyHtml = sanitizeOutreachHtml(String(body?.bodyHtml || ""));
  const bodyText = String(body?.bodyText || outreachHtmlToText(bodyHtml)).trim();
  const contactIds = Array.isArray(body?.contactIds)
    ? Array.from(new Set<string>(body.contactIds.map((value: unknown) => String(value))))
    : [];
  const allowRecentContact = body?.allowRecentContact === true;
  if (!name || !subject || !bodyText || !contactIds.length)
    return NextResponse.json({ ok: false, error: "Campaign name, subject, message, and at least one contact are required." }, { status: 400 });
  if (contactIds.length > MAX_CAMPAIGN_CONTACTS)
    return NextResponse.json({ ok: false, error: `Select no more than ${MAX_CAMPAIGN_CONTACTS} contacts for each campaign.` }, { status: 400 });

  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, status: true, recipients: { select: { status: true } } },
  });
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (campaign.status !== "DRAFT" || campaign.recipients.some((recipient) => recipient.status !== "PENDING"))
    return NextResponse.json({ ok: false, error: "Only a completely unsent draft campaign can be edited." }, { status: 409 });

  const contacts = await prisma.outreachContact.findMany({ where: { id: { in: contactIds } } });
  const suppressions = await prisma.outreachSuppression.findMany({
    where: { normalizedEmail: { in: contacts.map((contact) => contact.normalizedEmail).filter(Boolean) as string[] } },
    select: { normalizedEmail: true },
  });
  const blocked = new Set(suppressions.map((item) => item.normalizedEmail));
  const used = new Set<string>();
  const eligible = contacts.filter((contact) => {
    if (!contact.email || !contact.normalizedEmail || !contact.sourceUrl || contact.unsubscribedAt || contact.consentBasis === "UNASSESSED" || blocked.has(contact.normalizedEmail)) return false;
    if (!allowRecentContact && contact.lastContactedAt && contact.lastContactedAt >= recentContactCutoff()) return false;
    const email = normalizeEmail(contact.email);
    if (used.has(email)) return false;
    used.add(email);
    return true;
  });
  if (!eligible.length)
    return NextResponse.json({ ok: false, error: "No selected contacts are currently sendable." }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.outreachRecipient.deleteMany({ where: { campaignId: id, status: "PENDING" } });
    await tx.outreachCampaign.update({
      where: { id },
      data: {
        name, subject, bodyText, bodyHtml: bodyHtml || null, allowRecentContact,
        recipients: {
          create: eligible.map((contact) => {
            const vars = contactMergeVars(contact);
            return {
              contactId: contact.id,
              emailSnapshot: contact.email!,
              subjectSnapshot: renderMerge(subject, vars),
              bodyTextSnapshot: renderMerge(bodyText, vars),
              bodyHtmlSnapshot: bodyHtml ? renderMerge(bodyHtml, vars) : null,
              status: "PENDING",
            };
          }),
        },
      },
    });
  });
  await auditLog({
    action: "ADMIN_OUTREACH_CAMPAIGN_UPDATE",
    userId: gate.user.id,
    targetType: "OutreachCampaign",
    targetId: id,
    metadata: { recipientCount: eligible.length, skipped: contactIds.length - eligible.length },
    ...createAuditContext(req),
  });
  return NextResponse.json({ ok: true, recipientCount: eligible.length, skipped: contactIds.length - eligible.length });
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const confirmation = String(body?.confirmation || "");
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!campaign)
    return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (confirmation !== campaign.name)
    return NextResponse.json(
      { ok: false, error: "Type the exact campaign name to confirm deletion." },
      { status: 400 },
    );

  const deleted = await prisma.outreachCampaign.deleteMany({
    where: {
      id,
      status: "DRAFT",
      recipients: { every: { status: "PENDING" } },
    },
  });
  if (deleted.count !== 1)
    return NextResponse.json(
      { ok: false, error: "Only a draft campaign with no sent messages can be deleted." },
      { status: 409 },
    );

  await auditLog({
    action: "ADMIN_OUTREACH_CAMPAIGN_DELETE",
    userId: gate.user.id,
    targetType: "OutreachCampaign",
    targetId: id,
    metadata: { name: campaign.name },
    ...createAuditContext(req),
  });
  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
