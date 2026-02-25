import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { sendEmail } from "@/lib/email";
import bcrypt from "bcryptjs";

const RESET_SECRET = process.env.PASSWORD_RESET_SECRET || "your-reset-secret";
const SALT_ROUNDS = 12;

function hashToken(token: string): string {
  return createHash("sha256").update(RESET_SECRET + token).digest("hex");
}

function generateResetToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// POST /api/auth/forgot-password
// Request password reset
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      email?: string;
    } | null;

    if (!body?.email) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Email required." },
        { status: 400 }
      );
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: {
        id: true,
        email: true,
        firstName: true,
      },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json(
        { ok: true, message: "If an account exists with this email, you will receive a password reset link." },
        { status: 200 }
      );
    }

    // Generate reset token
    const token = generateResetToken();
    const tokenHash = hashToken(token);

    // Get request context
    const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    // Save token (expires in 1 hour)
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        ipAddress,
        userAgent,
      },
    });

    // Send reset email
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/reset-password?token=${token}&userId=${user.id}`;

    const emailResult = await sendEmail({
      to: user.email,
      subject: "Password Reset - TrueFantix",
      text: `Hi ${user.firstName},\n\nYou requested a password reset. Click this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hi ${user.firstName},</p>
          <p>You requested a password reset. Click the button below to reset your password:</p>
          <a href="${resetUrl}" style="display: inline-block; background-color: #2196F3; color: white; padding: 14px 20px; margin: 20px 0; text-decoration: none; border-radius: 4px;">Reset Password</a>
          <p>Or copy and paste this link into your browser:</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });

    if (!emailResult.ok) {
      console.error("Failed to send password reset email:", emailResult.error);
      return NextResponse.json(
        { ok: false, error: "EMAIL_FAILED", message: "Failed to send reset email." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, message: "If an account exists with this email, you will receive a password reset link." },
      { status: 200 }
    );

  } catch (err) {
    console.error("POST /api/auth/forgot-password failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not process request." },
      { status: 500 }
    );
  }
}

// GET /api/auth/forgot-password?token=xxx&userId=yyy
// Validate reset token
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

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
          },
        },
      },
    });

    if (!resetToken) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TOKEN", message: "Invalid or expired reset link." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: resetToken.user.id,
          email: resetToken.user.email,
          firstName: resetToken.user.firstName,
        },
      },
      { status: 200 }
    );

  } catch (err) {
    console.error("GET /api/auth/forgot-password failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not validate token." },
      { status: 500 }
    );
  }
}

// PATCH /api/auth/forgot-password
// Reset password with token
export async function PATCH(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      token?: string;
      userId?: string;
      newPassword?: string;
    } | null;

    if (!body?.token || !body?.userId || !body?.newPassword) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Token, userId, and newPassword required." },
        { status: 400 }
      );
    }

    // Validate password strength
    if (body.newPassword.length < 8) {
      return NextResponse.json(
        { ok: false, error: "WEAK_PASSWORD", message: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(body.token);

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId: body.userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!resetToken) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TOKEN", message: "Invalid or expired reset link." },
        { status: 400 }
      );
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(body.newPassword, SALT_ROUNDS);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: body.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json(
      { ok: true, message: "Password reset successfully. Please log in with your new password." },
      { status: 200 }
    );

  } catch (err) {
    console.error("PATCH /api/auth/forgot-password failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not reset password." },
      { status: 500 }
    );
  }
}
