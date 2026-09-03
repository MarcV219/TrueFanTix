import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { outreachHtmlToText, sanitizeOutreachHtml } from "@/lib/outreach-rich-text";
import { auditLog, createAuditContext } from "@/lib/audit";

export async function PATCH(req: Request, context: { params: Promise<{ id: string; recipientId: string }> }) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const { id, recipientId } = await context.params;
  const existing = await prisma.outreachRecipient.findFirst({ where: { id: recipientId, campaignId: id }, select: { id: true, status: true } });
  if (!existing) return NextResponse.json({ ok: false, error: "Campaign message not found." }, { status: 404 });
  if (existing.status !== "PENDING") return NextResponse.json({ ok: false, error: "Only pending messages can be edited." }, { status: 409 });
  const body = await req.json().catch(() => null);
  const subjectSnapshot = String(body?.subject || "").trim();
  const bodyHtmlSnapshot = sanitizeOutreachHtml(String(body?.bodyHtml || ""));
  const bodyTextSnapshot = String(body?.bodyText || outreachHtmlToText(bodyHtmlSnapshot)).trim();
  if (!subjectSnapshot || !bodyTextSnapshot) return NextResponse.json({ ok: false, error: "Subject and message are required." }, { status: 400 });
  const item = await prisma.outreachRecipient.update({ where: { id: recipientId }, data: { subjectSnapshot, bodyTextSnapshot, bodyHtmlSnapshot: bodyHtmlSnapshot || null } });
  await auditLog({ action: "ADMIN_OUTREACH_RECIPIENT_EDIT", userId: gate.user.id, targetType: "OutreachRecipient", targetId: recipientId, metadata: { campaignId: id }, ...createAuditContext(req) });
  return NextResponse.json({ ok: true, item });
}

export const runtime = "nodejs";
