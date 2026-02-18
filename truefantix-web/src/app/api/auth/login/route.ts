export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionForUser } from "@/lib/auth/session";

type LoginBody = {
  emailOrPhone?: string;
  password?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ error: "VALIDATION_ERROR", message }, { status: 400 });
}

function authError() {
  // Deliberately vague to avoid leaking which field was wrong
  return NextResponse.json(
    { error: "INVALID_CREDENTIALS", message: "Invalid email/phone or password." },
    { status: 401 }
  );
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(req: Request) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const emailOrPhoneRaw = (body.emailOrPhone ?? "").trim();
  const password = body.password ?? "";

  if (!emailOrPhoneRaw) return badRequest("Email or phone is required.");
  if (!password) return badRequest("Password is required.");

  // Determine whether input looks like an email
  const looksLikeEmail = emailOrPhoneRaw.includes("@");
  const email = looksLikeEmail ? normalizeEmail(emailOrPhoneRaw) : null;
  const phone = looksLikeEmail ? null : emailOrPhoneRaw;

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
    },
    select: {
      id: true,
      passwordHash: true,
      isBanned: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      canSell: true,
      role: true,
    },
  });

  if (!user) return authError();

  if (user.isBanned) {
    return NextResponse.json(
      { error: "BANNED", message: "This account is not permitted to log in." },
      { status: 403 }
    );
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return authError();

  // Update lastLoginAt (best effort)
  await prisma.user
    .update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    .catch(() => undefined);

  // Create session cookie
  await createSessionForUser(user.id);

  const isVerified = !!user.emailVerifiedAt && !!user.phoneVerifiedAt;

  return NextResponse.json(
    {
      ok: true,
      next: isVerified ? "/" : "/verify",
    },
    { status: 200 }
  );
}
