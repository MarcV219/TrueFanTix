export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail, generatePasswordResetEmail } from "@/lib/email";

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

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

const TOKEN_TTL_MINUTES = 30;
const MAX_REQUESTS_PER_HOUR = 3;

export async function POST(req: Request) {
  try {
    let body: { email?: string };
    try {
      body = (await req.json()) as { email?: string };
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Invalid JSON body.");
    }

    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return jsonError(400, "VALIDATION_ERROR", "Email is required.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError(400, "VALIDATION_ERROR", "Enter a valid email address.");
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    // Don't reveal if email exists (security)
    if (!user) {
      return NextResponse.json(
        { ok: true, message: "If an account exists, a reset email has been sent." },
        { status: 200 }
      );
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Rate limiting
    const requestsLastHour = await prisma.verificationCode.count({
      where: {
        userId: user.id,
        kind: "EMAIL",
        createdAt: { gte: oneHourAgo },
        destination: { startsWith: "reset:" },
      },
    });

    if (requestsLastHour >= MAX_REQUESTS_PER_HOUR) {
      return jsonError(
        429,
        "RATE_LIMITED",
        "Too many reset requests. Please wait before trying again."
      );
    }

    // Generate token
    const token = generateToken();
    const secret = getResetSecret();
    const tokenHash = sha256(secret + token);
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);

    // Store hashed token
    await prisma.verificationCode.create({
      data: {
        userId: user.id,
        kind: "EMAIL",
        destination: `reset:${user.email}`,
        codeHash: tokenHash,
        expiresAt,
        usedAt: null,
        attemptCount: 0,
        sendCount: 1,
        lastSentAt: now,
      },
    });

    // Send reset email
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
    const emailContent = generatePasswordResetEmail(resetUrl, user.firstName);
    const emailResult = await sendEmail({
      to: user.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    return NextResponse.json(
      {
        ok: true,
        message: "If an account exists, a reset email has been sent.",
        dev: !process.env.SENDGRID_API_KEY,
        resetUrl: emailResult.ok ? undefined : resetUrl, // Only show URL in dev mode if email failed
      },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("POST /api/auth/forgot-password error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
