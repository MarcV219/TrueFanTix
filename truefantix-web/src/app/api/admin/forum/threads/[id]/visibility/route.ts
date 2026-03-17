export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function getThreadIdFromUrl(req: Request): string {
  // /api/admin/forum/threads/<id>/visibility
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const threadsIndex = parts.indexOf("threads");
  if (threadsIndex !== -1 && parts.length > threadsIndex + 1) {
    return normalizeId(parts[threadsIndex + 1]);
  }
  return "";
}

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: "VALIDATION_ERROR", message },
    { status: 400 }
  );
}

/**
 * POST /api/admin/forum/threads/[id]/visibility
 * Admin only.
 *
 * Body:
 *  { visibility: "VISIBLE" | "HIDDEN" | "DELETED", reason?: string }
 *
 * Safety rule:
 *  - If a thread is DELETED, it cannot be restored (one-way).
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;

    const threadId = getThreadIdFromUrl(req);
    if (!threadId) return badRequest("Missing thread id.");

    const validation = await validateRequest(schemas.forumVisibilityApi)(req);
    if (!validation.success) return validation.response;

    const { visibility: nextVisibility, reason } = validation.data;

    const existing = await prisma.forumThread.findUnique({
      where: { id: threadId },
      select: { id: true, visibility: true },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    // One-way delete rule
    if (existing.visibility === "DELETED" && nextVisibility !== "DELETED") {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Deleted threads cannot be restored." },
        { status: 403 }
      );
    }

    const updated = await prisma.forumThread.update({
      where: { id: threadId },
      data: {
        visibility: nextVisibility,
        visibilityReason:
          nextVisibility === "VISIBLE" ? null : (reason ?? "Updated by admin."),
      },
      select: {
        id: true,
        visibility: true,
        visibilityReason: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, thread: updated });
  } catch (err) {
    console.error("POST /api/admin/forum/threads/[id]/visibility failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
