export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { createAuditContext } from "@/lib/audit";
import {
  REVIEWABLE_ATTENTION_ACKNOWLEDGED_ACTION, REVIEWABLE_ATTENTION_QUEUES,
  reviewableAttentionFingerprint, reviewableAttentionTargetId,
  FAILED_PAYMENT_WHERE, SUSPENDED_SELLER_WHERE, MODERATED_FORUM_WHERE,
  type ReviewableAttentionQueue,
} from "@/lib/adminQueueCounts";

type Item = { id: string; title: string; detail: string; changedAt: Date; fingerprint: string; severity: "PINK" | "YELLOW" };
function validQueue(value: string | null): value is ReviewableAttentionQueue { return REVIEWABLE_ATTENTION_QUEUES.includes(value as ReviewableAttentionQueue); }

async function loadItems(queue: ReviewableAttentionQueue, now = new Date()): Promise<Item[]> {
  if (queue === "expiredReservations") return (await prisma.ticket.findMany({ where: { status: "RESERVED", reservedUntil: { not: null, lt: now } }, orderBy: { reservedUntil: "asc" }, select: { id: true, title: true, section: true, row: true, seat: true, status: true, reservedUntil: true, updatedAt: true } })).map((item) => ({ id: item.id, title: item.title, detail: `${[item.section, item.row, item.seat].filter(Boolean).join(" • ") || "Seat not specified"} · expired ${item.reservedUntil?.toLocaleString()}`, changedAt: item.updatedAt, fingerprint: reviewableAttentionFingerprint([item.status, item.reservedUntil, item.updatedAt]), severity: "YELLOW" }));
  if (queue === "failedPayments") return (await prisma.payment.findMany({ where: FAILED_PAYMENT_WHERE, orderBy: { updatedAt: "desc" }, select: { id: true, orderId: true, amountCents: true, currency: true, status: true, providerRef: true, updatedAt: true } })).map((item) => ({ id: item.id, title: `Failed payment — ${(item.amountCents / 100).toFixed(2)} ${item.currency}`, detail: `Order ${item.orderId} · Stripe reference ${item.providerRef}`, changedAt: item.updatedAt, fingerprint: reviewableAttentionFingerprint([item.status, item.providerRef, item.updatedAt]), severity: "YELLOW" }));
  if (queue === "failedEmails") return (await prisma.emailDelivery.findMany({ where: { status: "FAILED", sentAt: { gte: new Date(now.getTime() - 86400000) } }, orderBy: { sentAt: "desc" }, select: { id: true, recipient: true, emailType: true, status: true, error: true, sentAt: true } })).map((item) => ({ id: item.id, title: `${item.emailType} to ${item.recipient}`, detail: item.error || "Delivery failed without a recorded reason.", changedAt: item.sentAt, fingerprint: reviewableAttentionFingerprint([item.status, item.error, item.sentAt]), severity: "YELLOW" }));
  if (queue === "suspendedSellers") return (await prisma.seller.findMany({ where: SUSPENDED_SELLER_WHERE, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, statusReason: true, updatedAt: true } })).map((item) => ({ id: item.id, title: item.name, detail: item.statusReason || "Seller is suspended.", changedAt: item.updatedAt, fingerprint: reviewableAttentionFingerprint([item.status, item.statusReason, item.updatedAt]), severity: "YELLOW" }));
  const [threads, posts] = await Promise.all([
    prisma.forumThread.findMany({ where: MODERATED_FORUM_WHERE, select: { id: true, title: true, visibility: true, visibilityReason: true, updatedAt: true } }),
    prisma.forumPost.findMany({ where: MODERATED_FORUM_WHERE, select: { id: true, body: true, visibility: true, visibilityReason: true, updatedAt: true } }),
  ]);
  return [
    ...threads.map((item) => ({ id: `thread-${item.id}`, title: `Thread: ${item.title}`, detail: item.visibilityReason || item.visibility, changedAt: item.updatedAt, fingerprint: reviewableAttentionFingerprint([item.visibility, item.visibilityReason, item.updatedAt]), severity: "YELLOW" as const })),
    ...posts.map((item) => ({ id: `post-${item.id}`, title: `Post: ${item.body.slice(0, 80)}`, detail: item.visibilityReason || item.visibility, changedAt: item.updatedAt, fingerprint: reviewableAttentionFingerprint([item.visibility, item.visibilityReason, item.updatedAt]), severity: "YELLOW" as const })),
  ].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const queue = new URL(req.url).searchParams.get("queue");
  if (!validQueue(queue)) return NextResponse.json({ ok: false, error: "Invalid queue." }, { status: 400 });
  const items = await loadItems(queue);
  const targetIds = items.map((item) => reviewableAttentionTargetId(queue, item.id));
  const acknowledgements = targetIds.length ? await prisma.auditLog.findMany({ where: { action: REVIEWABLE_ATTENTION_ACKNOWLEDGED_ACTION, targetType: "AdminQueueItem", targetId: { in: targetIds } }, orderBy: { createdAt: "desc" }, select: { targetId: true, createdAt: true, metadata: true, user: { select: { email: true } } } }) : [];
  const latest = new Map<string, (typeof acknowledgements)[number]>();
  for (const acknowledgement of acknowledgements) if (acknowledgement.targetId && !latest.has(acknowledgement.targetId)) latest.set(acknowledgement.targetId, acknowledgement);
  return NextResponse.json({ ok: true, queue, items: items.map((item) => { const ack = latest.get(reviewableAttentionTargetId(queue, item.id)); let fingerprint = ""; try { fingerprint = JSON.parse(ack?.metadata || "{}").fingerprint || ""; } catch {} const acknowledged = fingerprint === item.fingerprint; return { ...item, acknowledged, acknowledgedAt: acknowledged ? ack?.createdAt : null, acknowledgedBy: acknowledged ? ack?.user?.email : null }; }) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const queue = String(body?.queue || ""); const itemId = String(body?.itemId || "");
  if (!validQueue(queue) || !itemId) return NextResponse.json({ ok: false, error: "Queue and item are required." }, { status: 400 });
  const item = (await loadItems(queue)).find((candidate) => candidate.id === itemId);
  if (!item) return NextResponse.json({ ok: false, error: "Queue item no longer exists." }, { status: 404 });
  await prisma.auditLog.create({ data: { action: REVIEWABLE_ATTENTION_ACKNOWLEDGED_ACTION, userId: gate.user.id, targetType: "AdminQueueItem", targetId: reviewableAttentionTargetId(queue, item.id), metadata: JSON.stringify({ queue, itemId, fingerprint: item.fingerprint }), ...createAuditContext(req) } });
  return NextResponse.json({ ok: true });
}
