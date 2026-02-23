export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function getThreadIdFromUrl(req: Request): string {
  // /api/forum/threads/<id>
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const threadsIndex = parts.indexOf("threads");
  if (threadsIndex !== -1 && parts.length > threadsIndex + 1) {
    return normalizeId(parts[threadsIndex + 1]);
  }
  return "";
}

// We keep this permissive so the endpoint remains public.
// If logged in AND moderator/admin => moderator view.
// Otherwise => public view.
function isForumModerator(user: any): boolean {
  return Boolean(
    user?.isAdmin ||
      user?.isModerator ||
      user?.role === "ADMIN" ||
      user?.role === "MODERATOR"
  );
}

type SafeAuth =
  | { ok: true; user: any }
  | { ok: false };

// Try auth, but never block public reads.
async function tryGetVerifiedUser(req: Request): Promise<SafeAuth> {
  try {
    const auth = await requireVerifiedUser(req);
    if (!auth?.ok) return { ok: false };
    return { ok: true, user: (auth as any).user };
  } catch {
    return { ok: false };
  }
}

/**
 * GET /api/forum/threads/[id]
 * Public by default.
 *
 * - Regular users: VISIBLE posts + HIDDEN placeholders (to preserve thread continuity)
 * - Moderators/Admins: VISIBLE + HIDDEN posts (full body visible)
 *
 * Query params:
 *  - limit (default 50, max 100)
 *  - cursor (post id for pagination; optional)
 */
export async function GET(req: Request) {
  try {
    const threadId = getThreadIdFromUrl(req);
    if (!threadId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Missing thread id." },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Math.max(
      1,
      Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 50)
    );
    const cursor = url.searchParams.get("cursor");

    const auth = await tryGetVerifiedUser(req);
    const viewerIsModerator = auth.ok ? isForumModerator(auth.user) : false;

    // 1) Load thread (VISIBLE only)
    const threadBase = await prisma.forumThread.findFirst({
      where: {
        id: threadId,
        visibility: "VISIBLE",
      },
      select: {
        id: true,
        title: true,
        topicType: true,
        topic: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        isLocked: true,
        lockedAt: true,
        lockedReason: true,
        authorUserId: true,
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!threadBase) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    // 1b) Public-facing count: VISIBLE posts only (matches what users see as “real content”)
    const visiblePostCount = await prisma.forumPost.count({
      where: {
        threadId,
        visibility: "VISIBLE",
      },
    });

    const thread = {
      ...threadBase,
      _count: { posts: visiblePostCount },
    };

    // 2) Load posts:
    // - Mods: include VISIBLE + HIDDEN
    // - Public: include VISIBLE + HIDDEN (but we'll redact HIDDEN bodies into placeholders)
    const postsRaw = await prisma.forumPost.findMany({
      where: {
        threadId,
        visibility: viewerIsModerator
          ? { in: ["VISIBLE", "HIDDEN"] }
          : { in: ["VISIBLE", "HIDDEN"] },
      },
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
        threadId: true,
        body: true,
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
        parentId: true,
        visibility: true, // important for placeholders + moderation UI
      },
    });

    // 3) Redact hidden posts for non-moderators
    const posts =
      viewerIsModerator
        ? postsRaw
        : postsRaw.map((p: any) => {
            if (p.visibility === "HIDDEN") {
              return {
                ...p,
                body: "", // do not leak content
              };
            }
            return p;
          });

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return NextResponse.json(
      { ok: true, thread, posts: items, nextCursor, viewerIsModerator },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/forum/threads/[id] failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
