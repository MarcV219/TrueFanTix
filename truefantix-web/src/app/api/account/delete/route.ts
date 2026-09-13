export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { clearSessionCookie } from "@/lib/auth/session";
import {
  isPrimaryStagingManagedUser,
  primaryStagingManagedUserWhere,
} from "@/lib/primary/staging-console";
import { schemas, validateRequest } from "@/lib/validation";

const COOKIE_NAME = "tft_session";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function appendSessionCookieClears(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  for (const path of ["/auth", "/api", "/"]) {
    res.headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    );
  }
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

class ManagedAccountDeletionError extends Error {}
class AccountDeletionConflictError extends Error {}

/**
 * POST /api/account/delete
 * Body: { password }
 */
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;
    const userId = gate.user.id;

    const validation = await validateRequest(schemas.accountDelete)(req);
    if (!validation.success) return validation.response;

    const { password } = validation.data;

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

    if (!user) {
      // If session cookie exists but user was deleted, just clear cookie
      const res = NextResponse.json({ ok: true }, { status: 200 });
      appendSessionCookieClears(res);
      return res;
    }

    if (isPrimaryStagingManagedUser(user)) return stagingConsoleOnlyError();

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return jsonError(401, "INVALID_CREDENTIALS", "Password is incorrect.");
    }

    // Revalidate both the password and the managed-account boundary in the
    // destructive statement itself. Access-token persona restoration can race
    // bcrypt; deleting sessions first would otherwise revoke the replacement
    // console bearer before a later user deletion notices the restored persona.
    try {
      await prisma.$transaction(async (tx) => {
        const deleted = await tx.user.deleteMany({
          where: {
            id: userId,
            passwordHash: user.passwordHash,
            NOT: primaryStagingManagedUserWhere(),
          },
        });
        if (deleted.count === 1) return;

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
          throw new ManagedAccountDeletionError();
        }
        if (currentUser) throw new AccountDeletionConflictError();
      });
    } catch (error) {
      if (error instanceof ManagedAccountDeletionError) {
        return stagingConsoleOnlyError();
      }
      if (error instanceof AccountDeletionConflictError) {
        return jsonError(401, "INVALID_CREDENTIALS", "Password is incorrect.");
      }
      throw error;
    }

    await clearSessionCookie();

    const res = NextResponse.json({ ok: true }, { status: 200 });
    appendSessionCookieClears(res);

    return res;
  } catch (err: unknown) {
    console.error("POST /api/account/delete failed:", err);
    return jsonError(500, "SERVER_ERROR", err instanceof Error ? err.message : "Server error");
  }
}
