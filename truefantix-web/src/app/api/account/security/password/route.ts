export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentSessionTokenHash, getUserIdFromSessionCookie } from "@/lib/auth/session";
import {
  isPrimaryStagingManagedUser,
  primaryStagingManagedUserWhere,
} from "@/lib/primary/staging-console";
import { schemas, validateRequest } from "@/lib/validation";
import { applyRateLimit } from "@/lib/rate-limit";
import { enforceOriginAndCsrf } from "@/lib/security/csrf";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function stagingConsoleOnlyError() {
  const response = jsonError(
    403,
    "STAGING_CONSOLE_ONLY",
    "This managed account is restricted to the staging console.",
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

class ManagedAccountPasswordChangeError extends Error {}
class PasswordChangeConflictError extends Error {}

export async function POST(req: Request) {
  try {
    const csrf = await enforceOriginAndCsrf(req);
    if (!csrf.ok) return csrf.res;

    const rlResult = await applyRateLimit(req, "account:security-password-change");
    if (!rlResult.ok) return rlResult.response;

    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return jsonError(401, "UNAUTHORIZED", "Please log in.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
        passwordHash: true,
        isBanned: true,
      },
    });

    if (!user) return jsonError(401, "UNAUTHORIZED", "Please log in.");
    if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");
    if (isPrimaryStagingManagedUser(user)) return stagingConsoleOnlyError();

    // Validate request body with Zod
    const validation = await validateRequest(schemas.passwordChange)(req);
    if (!validation.success) {
      return validation.response;
    }

    const { currentPassword, newPassword } = validation.data;

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return jsonError(400, "INVALID_PASSWORD", "Current password is incorrect.");
    }

    // Hash and update new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    const currentSessionTokenHash = await getCurrentSessionTokenHash();

    // Revalidate the managed-account boundary in the same transaction as the
    // credential mutation. Persona restoration can otherwise race bcrypt and
    // let an in-flight ordinary password change overwrite the restored
    // staging password or revoke its newly issued console bearer.
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: {
            id: userId,
            passwordHash: user.passwordHash,
            NOT: primaryStagingManagedUserWhere(),
          },
          data: { passwordHash: newPasswordHash },
        });
        if (updated.count !== 1) {
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            select: {
              email: true,
              phone: true,
              termsVersion: true,
              privacyVersion: true,
            },
          });
          if (currentUser && isPrimaryStagingManagedUser(currentUser)) {
            throw new ManagedAccountPasswordChangeError();
          }
          throw new PasswordChangeConflictError();
        }

        await tx.session.deleteMany({
          where: {
            userId,
            ...(currentSessionTokenHash ? { tokenHash: { not: currentSessionTokenHash } } : {}),
          },
        });
      });
    } catch (error) {
      if (error instanceof ManagedAccountPasswordChangeError) {
        return stagingConsoleOnlyError();
      }
      if (error instanceof PasswordChangeConflictError) {
        return jsonError(400, "INVALID_PASSWORD", "Current password is incorrect.");
      }
      throw error;
    }

    return NextResponse.json(
      { ok: true, message: "Password changed successfully." },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("POST /api/account/security/password error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
