import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash, randomBytes } from "crypto";
import { sendEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import { schemas, validateRequest } from "@/lib/validation";
import { auditLog, createAuditContext } from "@/lib/audit";
import { applyRateLimit } from "@/lib/rate-limit";

const SALT_ROUNDS = 12;

function getResetSecret(): string {
  const secret = process.env.PASSWORD_RESET_SECRET?.trim();
  if (!secret || secret.length < 32 || secret === "your-reset-secret") {
    throw new Error("PASSWORD_RESET_SECRET is missing or too weak. Set a strong secret (min 32 chars).");
  }
  return secret;
}

function hashToken(token: string): string {
  return createHash("sha256").update(getResetSecret() + token).digest("hex");
}

function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

function getAppOrigin(req: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return new URL(req.url).origin;
  return null;
}

// POST /api/auth/forgot-password
// Request password reset
export async function POST(req: Request) {
  try {
    const rlResult = await applyRateLimit(req, "auth:forgot-password-request");
    if (!rlResult.ok) return rlResult.response;

    const validation = await validateRequest(schemas.forgotPasswordRequest)(req);
    if (!validation.success) return validation.response;

    const email = validation.data.email.toLowerCase();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
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

    const origin = getAppOrigin(req);
    if (!origin) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIGURED", message: "Application origin is not configured." },
        { status: 503 }
      );
    }

    // Send reset email
    const resetUrl = `${origin}/reset-password?token=${token}&userId=${user.id}`;

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

    await auditLog({
      action: "PASSWORD_RESET_REQUEST",
      userId: user.id,
      targetType: "User",
      targetId: user.id,
      metadata: { via: "email" },
      ...createAuditContext(req),
    });

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
    const rlResult = await applyRateLimit(req, "auth:forgot-password-reset");
    if (!rlResult.ok) return rlResult.response;

    const validation = await validateRequest(schemas.forgotPasswordReset)(req);
    if (!validation.success) return validation.response;

    const data = validation.data;

    const tokenHash = hashToken(data.token);

    // Find valid token
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId: data.userId,
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
    const passwordHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: data.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      prisma.session.deleteMany({ where: { userId: data.userId } }),
    ]);

    await auditLog({
      action: "PASSWORD_RESET_COMPLETE",
      userId: data.userId,
      targetType: "User",
      targetId: data.userId,
      metadata: { resetTokenId: resetToken.id },
      ...createAuditContext(req),
    });

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
