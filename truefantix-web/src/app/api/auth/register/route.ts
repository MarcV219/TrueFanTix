export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionForUser } from "@/lib/auth/session";
import { schemas, validateRequest } from "@/lib/validation";

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
  const validation = await validateRequest(schemas.authRegister)(req);
  if (!validation.success) return validation.response;

  const body = validation.data;

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

  const user = await prisma.user.create({
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
    },
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
}
