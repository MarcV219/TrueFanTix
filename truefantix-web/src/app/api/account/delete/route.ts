export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie, clearSessionCookie } from "@/lib/auth/session";

const COOKIE_NAME = "tft_session";

type DeleteBody = {
  password?: string;
};

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

/**
 * POST /api/account/delete
 * Body: { password }
 *
 * Bank-grade MVP constraints:
 * - Must be logged in
 * - Must re-enter password
 * - Deletes ALL sessions for the user
 * - Deletes the user (cascades to forum content, comments, verification codes, sessions, etc.)
 * - Clears session cookie on the response
 */
export async function POST(req: Request) {
  try {
    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");
    }

    let body: DeleteBody | null = null;
    try {
      body = (await req.json()) as DeleteBody;
    } catch {
      body = null;
    }

    const password = (body?.password ?? "").toString();
    if (!password) {
      return jsonError(400, "VALIDATION_ERROR", "Password is required to delete your account.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, isBanned: true },
    });

    if (!user) {
      // If session cookie exists but user was deleted, just clear cookie
      const res = NextResponse.json({ ok: true }, { status: 200 });
      const secure = process.env.NODE_ENV === "production";
      const base = {
        httpOnly: true as const,
        sameSite: "lax" as const,
        secure,
        expires: new Date(0),
        maxAge: 0,
      };
      res.cookies.set(COOKIE_NAME, "", { ...base, path: "/" });
      res.cookies.set(COOKIE_NAME, "", { ...base, path: "/api" });
      res.cookies.set(COOKIE_NAME, "", { ...base, path: "/auth" });
      return res;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return jsonError(401, "INVALID_CREDENTIALS", "Password is incorrect.");
    }

    // Defensive cleanup: delete all sessions first
    await prisma.session.deleteMany({ where: { userId } }).catch(() => undefined);

    // Delete the user record (cascades to:
    // - Session (onDelete: Cascade)
    // - ForumThread/ForumPost (onDelete: Cascade)
    // - CommunityComment (onDelete: Cascade)
    // - VerificationCode (onDelete: Cascade)
    // etc.
    await prisma.user.delete({ where: { id: userId } });

    // Clear cookie in BOTH ways:
    // 1) server-side cookie jar helper
    await clearSessionCookie();

    // 2) explicit response cookie clear (most reliable)
    const res = NextResponse.json({ ok: true }, { status: 200 });

    const secure = process.env.NODE_ENV === "production";
    const base = {
      httpOnly: true as const,
      sameSite: "lax" as const,
      secure,
      expires: new Date(0),
      maxAge: 0,
    };

    res.cookies.set(COOKIE_NAME, "", { ...base, path: "/" });
    res.cookies.set(COOKIE_NAME, "", { ...base, path: "/api" });
    res.cookies.set(COOKIE_NAME, "", { ...base, path: "/auth" });

    return res;
  } catch (err: any) {
    console.error("POST /api/account/delete failed:", err);
    return jsonError(500, "SERVER_ERROR", err?.message ?? "Server error");
  }
}
