export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionForUser } from "@/lib/auth/session";

type RegisterBody = {
  email?: string;
  phone?: string;
  password?: string;

  firstName?: string;
  lastName?: string;
  displayName?: string | null;

  streetAddress1?: string;
  streetAddress2?: string | null;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;

  acceptTerms?: boolean;
  acceptPrivacy?: boolean;
};

function badRequest(message: string) {
  return NextResponse.json({ error: "VALIDATION_ERROR", message }, { status: 400 });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  // Keep simple for now: trim spaces. Later you can enforce E.164.
  return phone.trim();
}

function isEmailLike(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongEnoughPassword(pw: string) {
  // Your MVP rule from earlier: >=10 chars, at least 1 letter and 1 number
  if (pw.length < 10) return false;
  const hasLetter = /[A-Za-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  return hasLetter && hasNumber;
}

export async function POST(req: Request) {
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const password = body.password ?? "";

  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();

  const streetAddress1 = (body.streetAddress1 ?? "").trim();
  const streetAddress2 = (body.streetAddress2 ?? "")?.trim() || null;
  const city = (body.city ?? "").trim();
  const region = (body.region ?? "").trim();
  const postalCode = (body.postalCode ?? "").trim();
  const country = (body.country ?? "").trim();

  const acceptTerms = body.acceptTerms === true;
  const acceptPrivacy = body.acceptPrivacy === true;

  // --- Validation (copy/paste friendly messages) ---
  if (!email) return badRequest("Email is required.");
  if (!isEmailLike(email)) return badRequest("Enter a valid email address.");

  if (!phone) return badRequest("Phone number is required.");
  if (phone.length < 7) return badRequest("Enter a valid phone number.");

  if (!password) return badRequest("Password is required.");
  if (!isStrongEnoughPassword(password))
    return badRequest("Password must be at least 10 characters and include at least one letter and one number.");

  if (!firstName) return badRequest("First name is required.");
  if (!lastName) return badRequest("Last name is required.");

  if (!country) return badRequest("Country is required.");
  if (!region) return badRequest("Province/State is required.");
  if (!city) return badRequest("City is required.");
  if (!postalCode) return badRequest("Postal/ZIP code is required.");
  if (!streetAddress1) return badRequest("Street address is required.");

  if (!acceptTerms) return badRequest("You must accept the Terms of Service to continue.");
  if (!acceptPrivacy) return badRequest("You must accept the Privacy Policy to continue.");

  const emailNorm = normalizeEmail(email);
  const phoneNorm = normalizePhone(phone);

  // --- Uniqueness checks ---
  const [existingByEmail, existingByPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email: emailNorm }, select: { id: true } }),
    prisma.user.findUnique({ where: { phone: phoneNorm }, select: { id: true } }),
  ]);

  if (existingByEmail) {
    return NextResponse.json(
      { error: "EMAIL_IN_USE", message: "That email is already in use. Log in instead." },
      { status: 409 }
    );
  }

  if (existingByPhone) {
    return NextResponse.json(
      { error: "PHONE_IN_USE", message: "That phone number is already in use. Log in instead." },
      { status: 409 }
    );
  }

  // --- Create user ---
  const passwordHash = await bcrypt.hash(password, 12);

  // You can bump these versions whenever you update legal docs
  const TERMS_VERSION = "v1";
  const PRIVACY_VERSION = "v1";

  const user = await prisma.user.create({
    data: {
      email: emailNorm,
      phone: phoneNorm,
      passwordHash,

      firstName,
      lastName,
      displayName: body.displayName?.trim() || null,

      streetAddress1,
      streetAddress2,
      city,
      region,
      postalCode,
      country,

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
