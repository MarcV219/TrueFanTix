export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: "VALIDATION_ERROR", message },
    { status: 400 }
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * GET /api/forum/threads
 * Public: lists VISIBLE threads, newest first.
 *
 * Query params:
 *  - limit (default 20, max 50)
 *  - cursor (thread id for pagination)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = clamp(Number(url.searchParams.get("limit") ?? 20), 1, 50);
    const cursor = url.searchParams.get("cursor");

    const where: any = { visibility: "VISIBLE" };

    const threads = await prisma.forumThread.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        title: true,
        topicType: true,
        topic: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,

        authorUserId: true,
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },

        _count: {
          select: {
            posts: true,
          },
        },

        posts: {
          take: 1,
          orderBy: { createdAt: "asc" }, // first post preview
          select: {
            id: true,
            body: true,
            createdAt: true,
            authorUserId: true,
          },
        },
      },
    });

    const hasMore = threads.length > limit;
    const items = hasMore ? threads.slice(0, limit) : threads;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return NextResponse.json({ ok: true, items, nextCursor });
  } catch (err) {
    console.error("GET /api/forum/threads failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/forum/threads
 * Verified users only, plus:
 *  - not banned (enforced by guard)
 *  - email+phone verified (enforced by guard)
 *  - canComment must be true
 *
 * Body:
 *  { title, topicType, topic?, body }
 *
 * Creates a thread + first post in one transaction.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireVerifiedUser(req);
    if (!auth.ok) return auth.res;

    const user = auth.user;

    if (!user.canComment) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Commenting is disabled for this account." },
        { status: 403 }
      );
    }

    const validation = await validateRequest(schemas.forumThreadCreateApi)(req);
    if (!validation.success) return validation.response;

    const { title, body: firstPostBody, topic, topicType = "OTHER", imageUrls } = validation.data;

    const created = await prisma.$transaction(async (tx: any) => {
      const thread = await tx.forumThread.create({
        data: {
          title,
          topicType,
          topic,
          visibility: "VISIBLE",
          authorUserId: user.id,
        },
        select: {
          id: true,
          title: true,
          topicType: true,
          topic: true,
          visibility: true,
          createdAt: true,
          updatedAt: true,
          authorUserId: true,
        },
      });

      const post = await tx.forumPost.create({
        data: {
          threadId: thread.id,
          body: firstPostBody,
          imageUrls,
          authorUserId: user.id,
        },
        select: {
          id: true,
          threadId: true,
          body: true,
          imageUrls: true,
          createdAt: true,
          authorUserId: true,
        },
      });

      return { thread, post };
    });

    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (err) {
    console.error("POST /api/forum/threads failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
