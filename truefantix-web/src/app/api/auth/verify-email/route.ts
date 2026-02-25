import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { sendEmail } from "@/lib/email";

const VERIFICATION_SECRET = process.env.VERIFICATION_SECRET || "your-secret-key";

function hashToken(token: string): string {
  return createHash("sha256").update(VERIFICATION_SECRET + token).digest("hex");
}

function generateVerificationToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// POST /api/auth/verify-email
// Send verification email
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      email?: string;
      userId?: string;
    } | null;

    if (!body?.email && !body?.userId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Email or userId required." },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: body.email ? { email: body.email } : { id: body.userId },
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

    // Generate new verification token
    const token = generateVerificationToken();
    const tokenHash = hashToken(token);

    // Save token to user
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: tokenHash },
    });

    // Send verification email
    const verificationUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/verify-email?token=${token}&userId=${user.id}`;

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
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");
    const userId = searchParams.get("userId");

    if (!token || !userId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS", message: "Token and userId required." },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(token);

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
