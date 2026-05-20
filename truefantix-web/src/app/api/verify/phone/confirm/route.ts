export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function getVerificationSecret() {
  // Allow fallback to SESSION_SECRET so dev/staging doesn't hard-fail.
  const secret = process.env.VERIFICATION_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  return secret;
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

const MAX_ATTEMPTS_PER_CODE = 10;

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) return gate.res;

  const validation = await validateRequest(schemas.verificationCodeConfirm)(req);
  if (!validation.success) return validation.response;

  const { code } = validation.data;

  const userId = gate.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, isBanned: true, phoneVerifiedAt: true },
  });

  if (!user) return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");
  if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");

  if (user.phoneVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true }, { status: 200 });
  }

  const now = new Date();

  const vc = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      kind: "PHONE",
      destination: user.phone,
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true,
      attemptCount: true,
    },
  });

  if (!vc) {
    return jsonError(400, "NO_ACTIVE_CODE", "No active code found. Please request a new code.");
  }

  if (vc.attemptCount >= MAX_ATTEMPTS_PER_CODE) {
    return jsonError(429, "TOO_MANY_ATTEMPTS", "Too many attempts. Please request a new code.");
  }

  const secret = getVerificationSecret();
  if (!secret) {
    return jsonError(
      503,
      "SERVER_MISCONFIGURED",
      "Verification is temporarily unavailable (missing VERIFICATION_SECRET/SESSION_SECRET)."
    );
  }
  const incomingHash = sha256(secret + code);

  const matches = crypto.timingSafeEqual(
    Buffer.from(incomingHash, "hex"),
    Buffer.from(vc.codeHash, "hex")
  );

  if (!matches) {
    await prisma.verificationCode.update({
      where: { id: vc.id },
      data: { attemptCount: vc.attemptCount + 1 },
    });
    return jsonError(401, "INVALID_CODE", "That code is not correct.");
  }

  await prisma.$transaction([
    prisma.verificationCode.update({
      where: { id: vc.id },
      data: { usedAt: now, attemptCount: vc.attemptCount + 1 },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: now },
    }),
  ]);

  return NextResponse.json({ ok: true, verified: "PHONE" }, { status: 200 });
}
