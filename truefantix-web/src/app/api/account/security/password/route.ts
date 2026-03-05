export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { schemas, validateRequest } from "@/lib/validation";
import { applyRateLimit } from "@/lib/rate-limit";
import { enforceOriginAndCsrf } from "@/lib/security/csrf";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

export async function POST(req: Request) {
  try {
    const csrf = await enforceOriginAndCsrf(req);
    if (!csrf.ok) return csrf.res;

    const rlResult = await applyRateLimit(req, "account:security-password-change");
    if (!rlResult.ok) return rlResult.response;

    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return jsonError(401, "UNAUTHORIZED", "Please log in.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, isBanned: true },
    });

    if (!user) return jsonError(401, "UNAUTHORIZED", "Please log in.");
    if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");

    // Validate request body with Zod
    const validation = await validateRequest(schemas.passwordChange)(req);
    if (!validation.success) {
      return validation.response;
    }

    const { currentPassword, newPassword } = validation.data;

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return jsonError(400, "INVALID_PASSWORD", "Current password is incorrect.");
    }

    // Hash and update new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      }),
      prisma.session.deleteMany({ where: { userId } }),
    ]);

    return NextResponse.json(
      { ok: true, message: "Password changed successfully." },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("POST /api/account/security/password error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
