export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function isStrongEnoughPassword(pw: string) {
  if (pw.length < 10) return false;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  return hasLetter && hasNumber;
}

export async function POST(req: Request) {
  try {
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

    let body: { currentPassword?: string; newPassword?: string };
    try {
      body = (await req.json()) as { currentPassword?: string; newPassword?: string };
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Invalid JSON body.");
    }

    const { currentPassword, newPassword } = body;

    if (!currentPassword) {
      return jsonError(400, "VALIDATION_ERROR", "Current password is required.");
    }

    if (!newPassword) {
      return jsonError(400, "VALIDATION_ERROR", "New password is required.");
    }

    if (!isStrongEnoughPassword(newPassword)) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        "New password must be at least 10 characters and include at least one letter and one number."
      );
    }

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return jsonError(400, "INVALID_PASSWORD", "Current password is incorrect.");
    }

    // Hash and update new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    return NextResponse.json(
      { ok: true, message: "Password changed successfully." },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("POST /api/account/security/password error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
