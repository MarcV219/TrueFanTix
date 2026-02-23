export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

type CreatePostBody = {
  threadId?: string;
  body?: string;
  parentId?: string | null; // optional reply-to
};

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: "VALIDATION_ERROR", message },
    { status: 400 }
  );
}

function normalizeString(v: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

function normalizeNullableId(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

/**
 * Enforce "max depth = 1" at the data level:
 * - If replying to a top-level post -> keep parentId as-is
 * - If replying to a reply (or deeper) -> attach to the top-level root instead
 *
 * Also ensures the entire chain is within the same thread and visible.
 */
async function resolveEffectiveParentId(args: {
  threadId: string;
  requestedParentId: string | null;
}): Promise<{ ok: true; parentId: string | null } | { ok: false; res: NextResponse }> {
  const { threadId, requestedParentId } = args;

  if (!requestedParentId) return { ok: true, parentId: null };

  // Walk up the chain to the top-level root.
  // This makes the rule resilient even if legacy/deep data exists.
  const MAX_HOPS = 25;

  let currentId: string | null = requestedParentId;
  let hops = 0;

  while (currentId) {
    if (hops++ > MAX_HOPS) {
      return {
        ok: false,
        res: NextResponse.json(
          {
            ok: false,
            error: "VALIDATION_ERROR",
            message: "Reply chain is too deep or invalid.",
          },
          { status: 400 }
        ),
      };
    }

    const post: { id: string; parentId: string | null } | null = await prisma.forumPost.findFirst({
      where: {
        id: currentId,
        threadId,
        visibility: "VISIBLE",
      },
      select: { id: true, parentId: true },
    });

    if (!post) {
      return {
        ok: false,
        res: NextResponse.json(
          {
            ok: false,
            error: "NOT_FOUND",
            message: "Parent post not found in this thread.",
          },
          { status: 404 }
        ),
      };
    }

    // If this post is top-level, it's the root.
    if (!post.parentId) {
      return { ok: true, parentId: post.id };
    }

    // Otherwise keep walking up.
    currentId = post.parentId;
  }

  // Fallback (should never happen)
  return { ok: true, parentId: null };
}

/**
 * POST /api/forum/posts
 * Verified users only (guard enforces: logged in, not banned, email+phone verified)
 *
 * Body:
 *  { threadId, body, parentId? }
 *
 * Rules:
 *  - user.canComment must be true
 *  - thread must exist AND be VISIBLE
 *  - thread must not be locked
 *  - if parentId provided, parent post must exist in same thread and be VISIBLE
 *  - depth enforcement: replies will be attached to the top-level root (max depth = 1)
 */
export async function POST(req: Request) {
  try {
    const auth = await requireVerifiedUser(req);
    if (!auth.ok) return auth.res;

    const user = auth.user;

    if (!user.canComment) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Commenting is disabled for this account.",
        },
        { status: 403 }
      );
    }

    const bodyJson = (await req.json().catch(() => null)) as CreatePostBody | null;
    if (!bodyJson) return badRequest("Invalid JSON body.");

    const threadId = normalizeString(bodyJson.threadId);
    const body = normalizeString(bodyJson.body);
    const requestedParentId = normalizeNullableId(bodyJson.parentId);

    if (!threadId) return badRequest("threadId is required.");
    if (body.length < 1) return badRequest("Post body is required.");
    if (body.length > 8000) return badRequest("Post must be 8000 characters or less.");

    // Validate thread
    const thread = await prisma.forumThread.findFirst({
      where: { id: threadId, visibility: "VISIBLE" },
      select: { id: true, isLocked: true },
    });

    if (!thread) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Thread not found." },
        { status: 404 }
      );
    }

    if (thread.isLocked) {
      return NextResponse.json(
        { ok: false, error: "THREAD_LOCKED", message: "This thread is locked." },
        { status: 423 }
      );
    }

    // Enforce depth + validate parent chain (if provided)
    const resolved = await resolveEffectiveParentId({
      threadId,
      requestedParentId,
    });
    if (!resolved.ok) return resolved.res;

    const effectiveParentId = resolved.parentId;

    const post = await prisma.forumPost.create({
      data: {
        threadId,
        body,
        parentId: effectiveParentId,
        authorUserId: user.id,
        visibility: "VISIBLE",
      },
      select: {
        id: true,
        threadId: true,
        body: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        authorUserId: true,
      },
    });

    return NextResponse.json({ ok: true, post }, { status: 201 });
  } catch (err) {
    console.error("POST /api/forum/posts failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
