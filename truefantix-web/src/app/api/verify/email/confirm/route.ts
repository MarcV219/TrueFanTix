export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function getVerificationSecret() {
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "VERIFICATION_SECRET is missing or too short. Set VERIFICATION_SECRET in .env (min 32 chars)."
    );
  }
  return secret;
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

type Body = { code?: string };

const MAX_ATTEMPTS_PER_CODE = 10;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Invalid JSON body.");
  }

  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return jsonError(400, "VALIDATION_ERROR", "Enter the 6-digit code.");
  }

  const userId = await getUserIdFromSessionCookie();
  if (!userId) return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isBanned: true, emailVerifiedAt: true },
  });

  if (!user) return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");
  if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");

  if (user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true }, { status: 200 });
  }

  const now = new Date();

  // Get the most recent active code for this destination
  const vc = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      kind: "EMAIL",
      destination: user.email,
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true,
      expiresAt: true,
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

  // Mark code used + verify email atomically-ish (transaction)
  await prisma.$transaction([
    prisma.verificationCode.update({
      where: { id: vc.id },
      data: { usedAt: now, attemptCount: vc.attemptCount + 1 },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: now },
    }),
  ]);

  return NextResponse.json({ ok: true, verified: "EMAIL" }, { status: 200 });
}
