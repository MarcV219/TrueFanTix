export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { schemas, validateRequest } from "@/lib/validation";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function getResetSecret() {
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("VERIFICATION_SECRET is missing or too short. Set in .env (min 32 chars).");
  }
  return secret;
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  try {
    const validation = await validateRequest(schemas.authResetPassword)(req);
    if (!validation.success) return validation.response;

    const { token, email, password } = validation.data;

    // Find the reset code
    const secret = getResetSecret();
    const tokenHash = sha256(secret + token);
    const now = new Date();

    const resetCode = await prisma.verificationCode.findFirst({
      where: {
        destination: `reset:${email.toLowerCase()}`,
        codeHash: tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!resetCode) {
      return jsonError(400, "INVALID_TOKEN", "Reset link is invalid or has expired.");
    }

    if (resetCode.attemptCount >= MAX_ATTEMPTS) {
      return jsonError(400, "MAX_ATTEMPTS", "Too many failed attempts. Please request a new reset link.");
    }

    // Increment attempt count
    await prisma.verificationCode.update({
      where: { id: resetCode.id },
      data: { attemptCount: { increment: 1 } },
    });

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: resetCode.userId },
      select: { id: true, email: true },
    });

    if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
      return jsonError(400, "INVALID_TOKEN", "Reset link is invalid.");
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      prisma.verificationCode.update({
        where: { id: resetCode.id },
        data: { usedAt: new Date() },
      }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    return NextResponse.json(
      { ok: true, message: "Password has been reset successfully." },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/auth/reset-password error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
