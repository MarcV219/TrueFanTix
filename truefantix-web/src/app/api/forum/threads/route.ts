export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ForumTopicType, ForumVisibility } from "@prisma/client";
import { requireVerifiedUser } from "@/lib/auth/guards";

type CreateThreadBody = {
  title?: string;
  topicType?: ForumTopicType | string;
  topic?: string | null;
  body?: string; // first post
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: "VALIDATION_ERROR", message },
    { status: 400 }
  );
}

function normalizeTopicType(v: unknown): ForumTopicType {
  const s = String(v ?? "").trim().toUpperCase();

  if (s === "ARTIST") return ForumTopicType.ARTIST;
  if (s === "TEAM") return ForumTopicType.TEAM;
  if (s === "SHOW") return ForumTopicType.SHOW;
  if (s === "OTHER") return ForumTopicType.OTHER;

  // Default to OTHER (safe MVP default)
  return ForumTopicType.OTHER;
}

function normalizeString(v: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
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

    const where = { visibility: ForumVisibility.VISIBLE as const };

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

    const bodyJson = (await req.json().catch(() => null)) as CreateThreadBody | null;
    if (!bodyJson) return badRequest("Invalid JSON body.");

    const title = normalizeString(bodyJson.title);
    const firstPostBody = normalizeString(bodyJson.body);

    if (title.length < 5) return badRequest("Title must be at least 5 characters.");
    if (title.length > 140) return badRequest("Title must be 140 characters or less.");

    if (firstPostBody.length < 5) return badRequest("Post must be at least 5 characters.");
    if (firstPostBody.length > 8000) return badRequest("Post must be 8000 characters or less.");

    const topicType = normalizeTopicType(bodyJson.topicType);
    const topic = bodyJson.topic == null ? null : String(bodyJson.topic).trim() || null;

    const created = await prisma.$transaction(async (tx) => {
      const thread = await tx.forumThread.create({
        data: {
          title,
          topicType,
          topic,
          visibility: ForumVisibility.VISIBLE,
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
          authorUserId: user.id,
        },
        select: {
          id: true,
          threadId: true,
          body: true,
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
