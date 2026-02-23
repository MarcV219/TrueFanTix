export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

type LockBody = {
  locked?: boolean;
  reason?: string | null;
};

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function getThreadIdFromUrl(req: Request): string {
  // /api/admin/forum/threads/<id>/lock
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
 * POST /api/admin/forum/threads/[id]/lock
 * Admin only.
 *
 * Body:
 *  { locked: true/false, reason?: string }
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;

    const threadId = getThreadIdFromUrl(req);
    if (!threadId) return badRequest("Missing thread id.");

    const bodyJson = (await req.json().catch(() => null)) as LockBody | null;
    if (!bodyJson) return badRequest("Invalid JSON body.");

    const locked = Boolean(bodyJson.locked);
    const reasonRaw = bodyJson.reason == null ? null : String(bodyJson.reason).trim();
    const reason = reasonRaw && reasonRaw.length ? reasonRaw.slice(0, 300) : null;

    const existing = await prisma.forumThread.findUnique({
      where: { id: threadId },
      select: { id: true, visibility: true },
    });

    if (!existing || existing.visibility === "DELETED") {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    const updated = await prisma.forumThread.update({
      where: { id: threadId },
      data: locked
        ? {
            isLocked: true,
            lockedAt: new Date(),
            lockedReason: reason ?? "Locked by admin.",
          }
        : {
            isLocked: false,
            lockedAt: null,
            lockedReason: null,
          },
      select: {
        id: true,
        isLocked: true,
        lockedAt: true,
        lockedReason: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, thread: updated });
  } catch (err) {
    console.error("POST /api/admin/forum/threads/[id]/lock failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
