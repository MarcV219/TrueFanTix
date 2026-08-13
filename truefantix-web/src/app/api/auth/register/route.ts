export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionForUser } from "@/lib/auth/session";
import { schemas, validateRequest } from "@/lib/validation";
import { applyRateLimit } from "@/lib/rate-limit";
import { grantEarlyAccessReward } from "@/lib/earlyAccessReward";
import { awardLaunchSignup } from "@/lib/launchPromotion";

function badRequest(message: string, details?: string[]) {
  return NextResponse.json(
    { ok: false, error: "VALIDATION_ERROR", message, ...(details ? { details } : {}) },
    { status: 400 }
  );
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  // Normalize to something close to E.164 for consistent uniqueness checks.
  // Keep leading "+" if present; strip spaces, dashes, parens, etc.
  const s = phone.trim().replace(/[^\d+]/g, "");
  return s;
}

export async function POST(req: Request) {
  const rlResult = await applyRateLimit(req, "auth:register");
  if (!rlResult.ok) return rlResult.response;

  const validation = await validateRequest(schemas.authRegister)(req);
  if (!validation.success) return validation.response;

  const body = validation.data;

  // Preflight: session config must exist before we create user, otherwise we'd create
  // an account and still fail with 500 while trying to set session cookie.
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIGURED",
        message: "Registration is temporarily unavailable (session configuration missing).",
      },
      { status: 503 }
    );
  }

  try {
    const emailNorm = normalizeEmail(body.email);
    const phoneNorm = normalizePhone(body.phone);

    // --- Uniqueness checks ---
    const [existingByEmail, existingByPhone] = await Promise.all([
      prisma.user.findUnique({ where: { email: emailNorm }, select: { id: true } }),
      prisma.user.findUnique({ where: { phone: phoneNorm }, select: { id: true } }),
    ]);

    if (existingByEmail) {
      return NextResponse.json(
        { ok: false, error: "EMAIL_IN_USE", message: "That email is already in use. Log in instead." },
        { status: 409 }
      );
    }

    if (existingByPhone) {
      return NextResponse.json(
        { ok: false, error: "PHONE_IN_USE", message: "That phone number is already in use. Log in instead." },
        { status: 409 }
      );
    }

    // --- Create user ---
    const passwordHash = await bcrypt.hash(body.password, 12);

    // You can bump these versions whenever you update legal docs
    const TERMS_VERSION = "v1";
    const PRIVACY_VERSION = "v1";

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: emailNorm,
          phone: phoneNorm,
          passwordHash,

          firstName: body.firstName,
          lastName: body.lastName,
          displayName: body.displayName ?? null,

          streetAddress1: body.streetAddress1,
          streetAddress2: body.streetAddress2 ?? null,
          city: body.city,
          region: body.region,
          postalCode: body.postalCode,
          country: body.country,

          canBuy: true,
          canComment: true,
          canSell: false,

          role: "USER",

          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          privacyAcceptedAt: new Date(),
          privacyVersion: PRIVACY_VERSION,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          displayName: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          canSell: true,
          role: true,
          createdAt: true,
          sellerId: true,
        },
      });
      const earlyAccessReward = await grantEarlyAccessReward(tx, created);
      await awardLaunchSignup(
        tx,
        { ...created, sellerId: earlyAccessReward.sellerId },
        created.createdAt,
        earlyAccessReward.amount
      );
      return created;
    });

    // Create session cookie so they are logged in immediately
    await createSessionForUser(user.id);

    return NextResponse.json(
      {
        ok: true,
        user,
        next: "/verify", // we'll build /verify later; for now it's just a hint to the client
      },
      { status: 201 }
    );
  } catch (e: any) {
    // Prisma uniqueness race (two requests at same time)
    const code = e?.code as string | undefined;
    if (code === "P2002") {
      const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(",") : String(e?.meta?.target ?? "");
      const message = target.includes("email")
        ? "That email is already in use. Log in instead."
        : target.includes("phone")
          ? "That phone number is already in use. Log in instead."
          : "That account detail is already in use. Log in instead.";
      return NextResponse.json({ ok: false, error: "DUPLICATE", message }, { status: 409 });
    }

    console.error("/api/auth/register failed", e);
    const reason = e instanceof Error ? e.message : "Unknown server error";
    const codeText = typeof code === "string" ? ` [${code}]` : "";
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: `Registration failed${codeText}: ${reason}`,
      },
      { status: 500 }
    );
  }
}
