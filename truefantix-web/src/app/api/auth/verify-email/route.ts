import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash, randomBytes } from "crypto";
import { sendEmail } from "@/lib/email";
import { schemas, validateRequest } from "@/lib/validation";
import { applyRateLimit } from "@/lib/rate-limit";

function getVerificationSecret(): string | null {
  const secret = process.env.VERIFICATION_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

function hashToken(token: string, secret: string): string {
  return createHash("sha256").update(secret + token).digest("hex");
}

function getAppOrigin(req: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return new URL(req.url).origin;
  return null;
}

function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

// POST /api/auth/verify-email
// Send verification email
export async function POST(req: Request) {
  try {
    const rlResult = await applyRateLimit(req, "verify:email:send");
    if (!rlResult.ok) return rlResult.response;

    const validation = await validateRequest(schemas.authVerifyEmailSend)(req);
    if (!validation.success) return validation.response;

    const { email, userId } = validation.data;

    // Find user
    const user = await prisma.user.findFirst({
      where: email ? { email } : { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        emailVerifiedAt: true,
        emailVerificationToken: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "USER_NOT_FOUND", message: "User not found." },
        { status: 404 }
      );
    }

    // Check if already verified
    if (user.emailVerifiedAt) {
      return NextResponse.json(
        { ok: false, error: "ALREADY_VERIFIED", message: "Email already verified." },
        { status: 400 }
      );
    }

    const secret = getVerificationSecret();
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIGURED", message: "Email verification is temporarily unavailable." },
        { status: 503 }
      );
    }

    const origin = getAppOrigin(req);
    if (!origin) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIGURED", message: "Application origin is not configured." },
        { status: 503 }
      );
    }

    // Generate new verification token
    const token = generateVerificationToken();
    const tokenHash = hashToken(token, secret);

    // Save token to user
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: tokenHash },
    });

    // Send verification email
    const verificationUrl = `${origin}/verify-email?token=${token}&userId=${user.id}`;

    const emailResult = await sendEmail({
      to: user.email,
      subject: "Verify your email - TrueFantix",
      text: `Hi ${user.firstName},\n\nPlease verify your email by clicking this link: ${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create this account, you can ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to TrueFantix!</h2>
          <p>Hi ${user.firstName},</p>
          <p>Please verify your email address by clicking the button below:</p>
          <a href="${verificationUrl}" style="display: inline-block; background-color: #4CAF50; color: white; padding: 14px 20px; margin: 20px 0; text-decoration: none; border-radius: 4px;">Verify Email</a>
          <p>Or copy and paste this link into your browser:</p>
          <p><a href="${verificationUrl}">${verificationUrl}</a></p>
          <p>This link expires in 24 hours.</p>
          <p>If you didn't create this account, you can ignore this email.</p>
        </div>
      `,
    });

    if (!emailResult.ok) {
      console.error("Failed to send verification email:", emailResult.error);
      return NextResponse.json(
        { ok: false, error: "EMAIL_FAILED", message: "Failed to send verification email." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, message: "Verification email sent. Please check your inbox." },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/auth/verify-email failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not send verification email." },
      { status: 500 }
    );
  }
}

// GET /api/auth/verify-email?token=xxx&userId=yyy
// Verify email with token
export async function GET(req: Request) {
  try {
    const rlResult = await applyRateLimit(req, "verify:email:confirm");
    if (!rlResult.ok) return rlResult.response;

    const { searchParams } = new URL(req.url);

    const parsed = schemas.authVerifyEmailConfirm.safeParse({
      token: searchParams.get("token"),
      userId: searchParams.get("userId"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_PARAMS",
          message: "Token and userId required.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        { status: 400 }
      );
    }

    const { token, userId } = parsed.data;

    const secret = getVerificationSecret();
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIGURED", message: "Email verification is temporarily unavailable." },
        { status: 503 }
      );
    }

    const tokenHash = hashToken(token, secret);

    // Find user with matching token
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        emailVerificationToken: tokenHash,
      },
      select: {
        id: true,
        emailVerifiedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TOKEN", message: "Invalid or expired verification link." },
        { status: 400 }
      );
    }

    // Check if already verified
    if (user.emailVerifiedAt) {
      return NextResponse.json(
        { ok: true, message: "Email already verified." },
        { status: 200 }
      );
    }

    // Mark email as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
      },
    });

    return NextResponse.json(
      { ok: true, message: "Email verified successfully!" },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/auth/verify-email failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not verify email." },
      { status: 500 }
    );
  }
}
