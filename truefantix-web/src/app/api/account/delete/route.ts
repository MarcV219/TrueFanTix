export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { clearSessionCookie } from "@/lib/auth/session";
import { schemas, validateRequest } from "@/lib/validation";

const COOKIE_NAME = "tft_session";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function appendSessionCookieClears(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  for (const path of ["/auth", "/api", "/"]) {
    res.headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    );
  }
}

/**
 * POST /api/account/delete
 * Body: { password }
 */
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;
    const userId = gate.user.id;

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
      appendSessionCookieClears(res);
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
    appendSessionCookieClears(res);

    return res;
  } catch (err: any) {
    console.error("POST /api/account/delete failed:", err);
    return jsonError(500, "SERVER_ERROR", err?.message ?? "Server error");
  }
}
