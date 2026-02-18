export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

type CreateCommentBody = {
  body?: string;
  parentId?: string | null;

  // Optional associations
  ticketId?: string | null;
  eventId?: string | null;
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message }, { status: 400 });
}

function normalizeId(v: unknown) {
  try {
    return decodeURIComponent(String(v ?? "")).trim();
  } catch {
    return String(v ?? "").trim();
  }
}

export async function POST(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  if (gate.user.canComment !== true) {
    return NextResponse.json(
      { ok: false, error: "COMMENTING_DISABLED", message: "Commenting is disabled for this account." },
      { status: 403 }
    );
  }

  let body: CreateCommentBody;
  try {
    body = (await req.json()) as CreateCommentBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const text = (body.body ?? "").trim();
  if (!text) return badRequest("Comment text is required.");
  if (text.length > 2000) return badRequest("Comment must be 2000 characters or less.");

  const parentId = body.parentId ? normalizeId(body.parentId) : null;
  const ticketId = body.ticketId ? normalizeId(body.ticketId) : null;
  const eventId = body.eventId ? normalizeId(body.eventId) : null;

  // Require a “target” OR a parent (reply)
  if (!parentId && !ticketId && !eventId) {
    return badRequest("Choose what you are commenting on (ticketId or eventId) or provide parentId to reply.");
  }

  // Prevent ambiguous targets (keep MVP simple)
  const targetCount = [ticketId, eventId].filter(Boolean).length;
  if (targetCount > 1) {
    return badRequest("Provide only one of ticketId or eventId.");
  }

  // If replying, ensure parent exists and is not deleted
  if (parentId) {
    const parent = await prisma.communityComment.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        isDeleted: true,
        ticketId: true,
        eventId: true,
      },
    });

    if (!parent) return badRequest("Parent comment not found.");
    if (parent.isDeleted) return badRequest("Cannot reply to a deleted comment.");

    // If parent has a target, inherit it (prevents mismatched thread targets)
    const inheritedTicketId = parent.ticketId ?? null;
    const inheritedEventId = parent.eventId ?? null;

    if (ticketId && inheritedTicketId && ticketId !== inheritedTicketId)
      return badRequest("Reply ticketId does not match parent comment.");
    if (eventId && inheritedEventId && eventId !== inheritedEventId)
      return badRequest("Reply eventId does not match parent comment.");

    // Lock reply target to parent's target
    const finalTicketId = inheritedTicketId ?? ticketId;
    const finalEventId = inheritedEventId ?? eventId;

    const created = await prisma.communityComment.create({
      data: {
        userId: gate.user.id,
        body: text,
        parentId: parent.id,
        ticketId: finalTicketId,
        eventId: finalEventId,
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        body: true,
        parentId: true,
        ticketId: true,
        eventId: true,
        isDeleted: true,
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, comment: created }, { status: 201 });
  }

  // If not replying: validate target exists (optional but helpful)
  if (ticketId) {
    const exists = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!exists) return badRequest("Ticket not found.");
  }
  if (eventId) {
    const exists = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!exists) return badRequest("Event not found.");
  }

  const created = await prisma.communityComment.create({
    data: {
      userId: gate.user.id,
      body: text,
      ticketId,
      eventId,
    },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      body: true,
      parentId: true,
      ticketId: true,
      eventId: true,
      isDeleted: true,
      user: {
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return NextResponse.json({ ok: true, comment: created }, { status: 201 });
}
