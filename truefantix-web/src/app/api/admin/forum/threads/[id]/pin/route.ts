export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

function threadIdFromRequest(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("threads");
  return index >= 0 ? decodeURIComponent(parts[index + 1] || "").trim() : "";
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;

    const threadId = threadIdFromRequest(req);
    if (!threadId) return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message: "Missing thread id." }, { status: 400 });

    const validation = await validateRequest(schemas.forumPinApi)(req);
    if (!validation.success) return validation.response;

    const existing = await prisma.forumThread.findUnique({ where: { id: threadId }, select: { id: true, visibility: true } });
    if (!existing || existing.visibility === "DELETED") return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const thread = await prisma.forumThread.update({
      where: { id: threadId },
      data: { isPinned: validation.data.pinned, pinnedAt: validation.data.pinned ? new Date() : null },
      select: { id: true, isPinned: true, pinnedAt: true },
    });

    return NextResponse.json({ ok: true, thread });
  } catch (error) {
    console.error("POST /api/admin/forum/threads/[id]/pin failed:", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
