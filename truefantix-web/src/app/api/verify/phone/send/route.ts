export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { sendSms, generateVerificationSms } from "@/lib/sms";

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

function generate6DigitCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

const CODE_TTL_MINUTES = 10;
const MIN_SECONDS_BETWEEN_SENDS = 60;
const MAX_SENDS_PER_HOUR = 5;

export async function POST(req: Request) {
  void req;

  const userId = await getUserIdFromSessionCookie();
  if (!userId) return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      isBanned: true,
      phoneVerifiedAt: true,
    },
  });

  if (!user) return jsonError(401, "NOT_AUTHENTICATED", "Please log in.");
  if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");
  if (user.phoneVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true }, { status: 200 });
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const sendsLastHour = await prisma.verificationCode.count({
    where: {
      userId: user.id,
      kind: "PHONE",
      createdAt: { gte: oneHourAgo },
    },
  });

  if (sendsLastHour >= MAX_SENDS_PER_HOUR) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Too many verification texts requested. Please wait and try again."
    );
  }

  const active = await prisma.verificationCode.findFirst({
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
        kind: "PHONE",
        destination: user.phone,
        codeHash,
        expiresAt,
        usedAt: null,
        attemptCount: 0,
        sendCount: 1,
        lastSentAt: now,
      },
    });
  }

  // Send the SMS
  const smsContent = generateVerificationSms(code);
  const smsResult = await sendSms({
    to: user.phone,
    body: smsContent.body,
  });

  return NextResponse.json(
    {
      ok: true,
      delivered: smsResult.ok,
      dev: !process.env.TWILIO_ACCOUNT_SID,
      expiresInMinutes: CODE_TTL_MINUTES,
    },
    { status: 200 }
  );
}
