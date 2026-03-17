export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionForUser } from "@/lib/auth/session";
import { schemas, validateRequest } from "@/lib/validation";
import { auditLog, createAuditContext } from "@/lib/audit";
import { applyRateLimit } from "@/lib/rate-limit";
import { ensureCsrfCookie, csrfCookieName } from "@/lib/security/csrf";

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
  const rlResult = await applyRateLimit(req, "auth:login");
  if (!rlResult.ok) return rlResult.response;

  const validation = await validateRequest(schemas.authLogin)(req);
  if (!validation.success) return validation.response;

  const emailOrPhoneRaw = validation.data.emailOrPhone.trim();
  const password = validation.data.password;

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
  const csrfToken = await ensureCsrfCookie();

  const isVerified = !!user.emailVerifiedAt && !!user.phoneVerifiedAt;

  await auditLog({
    action: "USER_LOGIN",
    userId: user.id,
    targetType: "User",
    targetId: user.id,
    metadata: { isVerified },
    ...createAuditContext(req),
  });

  return NextResponse.json(
    {
      ok: true,
      next: isVerified ? "/" : "/verify",
      csrfToken,
      csrfCookie: csrfCookieName(),
    },
    { status: 200 }
  );
}
