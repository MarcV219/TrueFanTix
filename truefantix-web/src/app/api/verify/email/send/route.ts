export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail, generateVerificationEmail } from "@/lib/email";

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

function generate6DigitCode() {
  // 000000 - 999999, zero padded
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

const CODE_TTL_MINUTES = 10;
const MIN_SECONDS_BETWEEN_SENDS = 60;
const MAX_SENDS_PER_HOUR = 5;

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) return gate.res;

  const userId = gate.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      isBanned: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");
  if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");
  if (user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true }, { status: 200 });
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Count sends in the last hour (simple abuse control)
  const sendsLastHour = await prisma.verificationCode.count({
    where: {
      userId: user.id,
      kind: "EMAIL",
      createdAt: { gte: oneHourAgo },
    },
  });

  if (sendsLastHour >= MAX_SENDS_PER_HOUR) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Too many verification emails requested. Please wait and try again."
    );
  }

  // If there is an active (unused + unexpired) code, throttle resends via lastSentAt
  const active = await prisma.verificationCode.findFirst({
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
      sendCount: true,
      lastSentAt: true,
    },
  });

  if (active?.lastSentAt) {
    const secondsSince = Math.floor((now.getTime() - active.lastSentAt.getTime()) / 1000);
    if (secondsSince < MIN_SECONDS_BETWEEN_SENDS) {
      return jsonError(
        429,
        "RATE_LIMITED",
        `Please wait ${MIN_SECONDS_BETWEEN_SENDS - secondsSince}s before requesting another code.`
      );
    }
  }

  const code = generate6DigitCode();
  const secret = getVerificationSecret();
  if (!secret) {
    return jsonError(
      503,
      "SERVER_MISCONFIGURED",
      "Verification is temporarily unavailable (missing VERIFICATION_SECRET/SESSION_SECRET)."
    );
  }
  const codeHash = sha256(secret + code);
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);

  if (active) {
    await prisma.verificationCode.update({
      where: { id: active.id },
      data: {
        codeHash,
        expiresAt,
        usedAt: null,
        attemptCount: 0,
        sendCount: active.sendCount + 1,
        lastSentAt: now,
      },
    });
  } else {
    await prisma.verificationCode.create({
      data: {
        userId: user.id,
        kind: "EMAIL",
        destination: user.email,
        codeHash,
        expiresAt,
        usedAt: null,
        attemptCount: 0,
        sendCount: 1,
        lastSentAt: now,
      },
    });
  }

  // Send the email
  const emailContent = generateVerificationEmail(code, user.firstName);
  const emailResult = await sendEmail({
    to: user.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  if (!emailResult.ok) {
    return jsonError(503, "EMAIL_DELIVERY_FAILED", emailResult.error ?? "Could not send verification email.");
  }

  return NextResponse.json(
    {
      ok: true,
      delivered: true,
      dev: !process.env.RESEND_API_KEY && !process.env.SENDGRID_API_KEY,
      expiresInMinutes: CODE_TTL_MINUTES,
    },
    { status: 200 }
  );
}
