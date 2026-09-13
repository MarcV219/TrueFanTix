export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

class ManagedAccountCommentError extends Error {}
class CommentingDisabledError extends Error {}

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

function stagingConsoleOnlyError() {
  const response = NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function commentingDisabledError() {
  return NextResponse.json(
    { ok: false, error: "COMMENTING_DISABLED", message: "Commenting is disabled for this account." },
    { status: 403 },
  );
}

const commentSelect = {
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
} satisfies Prisma.CommunityCommentSelect;

async function createOrdinaryComment(
  userId: string,
  data: Prisma.CommunityCommentUncheckedCreateInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize against access-token persona restoration. Whichever operation
      // locks the account first establishes whether this content write belongs
      // to the ordinary account or to the managed staging persona.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          phone: true,
          termsVersion: true,
          privacyVersion: true,
          canComment: true,
        },
      });

      if (!current) throw new Error("ACCOUNT_NOT_FOUND");
      if (isPrimaryStagingManagedUser(current)) throw new ManagedAccountCommentError();
      if (current.canComment !== true) throw new CommentingDisabledError();

      return tx.communityComment.create({ data, select: commentSelect });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ManagedAccountCommentError || error instanceof CommentingDisabledError) {
      throw error;
    }

    // A serializable transaction can abort when persona restoration wins the
    // row race. Reclassify only from the current complete managed predicate.
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
      },
    });
    if (current && isPrimaryStagingManagedUser(current)) {
      throw new ManagedAccountCommentError();
    }
    throw error;
  }
}

export async function POST(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  if (gate.user.canComment !== true) {
    return commentingDisabledError();
  }

  const validation = await validateRequest(schemas.communityCommentCreateApi)(req);
  if (!validation.success) return validation.response;

  const body = validation.data;

  const text = body.body;

  const parentId = body.parentId ? normalizeId(body.parentId) : null;
  const ticketId = body.ticketId ? normalizeId(body.ticketId) : null;
  const eventId = body.eventId ? normalizeId(body.eventId) : null;

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

    let created;
    try {
      created = await createOrdinaryComment(gate.user.id, {
        userId: gate.user.id,
        body: text,
        parentId: parent.id,
        ticketId: finalTicketId,
        eventId: finalEventId,
      });
    } catch (error) {
      if (error instanceof ManagedAccountCommentError) return stagingConsoleOnlyError();
      if (error instanceof CommentingDisabledError) return commentingDisabledError();
      throw error;
    }

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

  let created;
  try {
    created = await createOrdinaryComment(gate.user.id, {
      userId: gate.user.id,
      body: text,
      ticketId,
      eventId,
    });
  } catch (error) {
    if (error instanceof ManagedAccountCommentError) return stagingConsoleOnlyError();
    if (error instanceof CommentingDisabledError) return commentingDisabledError();
    throw error;
  }

  return NextResponse.json({ ok: true, comment: created }, { status: 201 });
}
