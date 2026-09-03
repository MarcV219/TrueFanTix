import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const TYPES = new Set(["CALL", "MEETING", "DIRECT_EMAIL", "SOCIAL_MESSAGE", "CONTACT_FORM", "OTHER"]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const type = String(body?.type || "");
  const subject = String(body?.subject || "").trim().slice(0, 500);
  const occurredAt = new Date(body?.occurredAt || "");
  const followUpAt = body?.followUpAt ? new Date(body.followUpAt) : null;
  if (!TYPES.has(type)) return NextResponse.json({ ok: false, error: "Choose a valid communication type." }, { status: 400 });
  if (!subject) return NextResponse.json({ ok: false, error: "Subject is required." }, { status: 400 });
  if (Number.isNaN(occurredAt.getTime()) || (followUpAt && Number.isNaN(followUpAt.getTime()))) return NextResponse.json({ ok: false, error: "Enter a valid date and time." }, { status: 400 });
  const exists = await prisma.outreachContact.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ ok: false, error: "Contact not found." }, { status: 404 });
  const [item] = await prisma.$transaction([
    prisma.outreachCommunication.create({ data: { contactId: id, type, occurredAt, subject, notes: String(body?.notes || "").trim().slice(0, 20000) || null, createdById: gate.user.id } }),
    ...(followUpAt ? [prisma.outreachContact.update({ where: { id }, data: { followUpAt, engagementStage: "FOLLOW_UP" } })] : []),
  ]);
  return NextResponse.json({ ok: true, item });
}
