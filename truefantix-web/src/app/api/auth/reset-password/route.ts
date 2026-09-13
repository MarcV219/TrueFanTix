export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { schemas, validateRequest } from "@/lib/validation";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  isPrimaryStagingManagedUser,
  primaryStagingManagedUserWhere,
} from "@/lib/primary/staging-console";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function privateJsonError(status: number, error: string, message: string) {
  const response = jsonError(status, error, message);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
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

class InvalidPasswordResetError extends Error {}

export async function POST(req: Request) {
  try {
    const rlResult = await applyRateLimit(req, "auth:forgot-password-reset");
    if (!rlResult.ok) return rlResult.response;

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

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: resetCode.userId },
      select: { id: true, email: true, phone: true, termsVersion: true, privacyVersion: true },
    });

    if (user && isPrimaryStagingManagedUser(user)) {
      return privateJsonError(400, "INVALID_TOKEN", "Reset link is invalid.");
    }

    if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
      return jsonError(400, "INVALID_TOKEN", "Reset link is invalid.");
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Consume the code and revalidate the managed-account boundary atomically.
    // A staging persona restored while bcrypt is running must not inherit the
    // caller's password or lose its newly issued console session.
    try {
      await prisma.$transaction(async (tx) => {
        const usedAt = new Date();
        const consumed = await tx.verificationCode.updateMany({
          where: {
            id: resetCode.id,
            userId: user.id,
            destination: `reset:${email.toLowerCase()}`,
            codeHash: tokenHash,
            usedAt: null,
            expiresAt: { gt: usedAt },
            attemptCount: { lt: MAX_ATTEMPTS },
          },
          data: {
            attemptCount: { increment: 1 },
            usedAt,
          },
        });
        if (consumed.count !== 1) throw new InvalidPasswordResetError();

        const updated = await tx.user.updateMany({
          where: {
            id: user.id,
            email: { equals: email, mode: "insensitive" },
            NOT: primaryStagingManagedUserWhere(),
          },
          data: { passwordHash },
        });
        if (updated.count !== 1) throw new InvalidPasswordResetError();

        await tx.session.deleteMany({ where: { userId: user.id } });
      });
    } catch (error) {
      if (error instanceof InvalidPasswordResetError) {
        return privateJsonError(400, "INVALID_TOKEN", "Reset link is invalid.");
      }
      throw error;
    }

    return NextResponse.json(
      { ok: true, message: "Password has been reset successfully." },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("POST /api/auth/reset-password error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
