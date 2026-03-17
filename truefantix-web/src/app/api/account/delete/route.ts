export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie, clearSessionCookie } from "@/lib/auth/session";
import { schemas, validateRequest } from "@/lib/validation";

const COOKIE_NAME = "tft_session";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

/**
 * POST /api/account/delete
 * Body: { password }
 */
export async function POST(req: Request) {
  try {
    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");
    }

    const validation = await validateRequest(schemas.accountDelete)(req);
    if (!validation.success) return validation.response;

    const { password } = validation.data;

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

    await prisma.session.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } });

    await clearSessionCookie();

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
