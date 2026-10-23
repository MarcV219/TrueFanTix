import { NextResponse } from "next/server";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { enforceOriginAndCsrf } from "@/lib/security/csrf";
import { requirePrimaryPreflight } from "./config";
import { STAGING_BUYER_EMAIL } from "./staging-console";

function error(status: number, code: string, message: string) {
  const response = NextResponse.json({ ok: false, error: code, message }, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function requirePrimaryPilotBuyer(req: Request) {
  let capability;
  try {
    capability = requirePrimaryPreflight();
  } catch {
    return { ok: false as const, res: error(404, "NOT_FOUND", "Not found.") };
  }
  if (capability.environmentId !== "isolated-preview" || process.env.VERCEL_ENV !== "preview") {
    return { ok: false as const, res: error(404, "NOT_FOUND", "Not found.") };
  }
  const csrf = await enforceOriginAndCsrf(req);
  if (!csrf.ok) return { ok: false as const, res: csrf.res };
  const userId = await getUserIdFromSessionCookie();
  if (!userId) return { ok: false as const, res: error(401, "NOT_AUTHENTICATED", "Use the staging console buyer persona first.") };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.email.trim().toLowerCase() !== STAGING_BUYER_EMAIL || user.role !== "USER" || user.isBanned || !user.emailVerifiedAt || !user.phoneVerifiedAt) {
    return { ok: false as const, res: error(403, "STAGING_BUYER_REQUIRED", "Use the staging console buyer persona first.") };
  }
  return { ok: true as const, capability, user };
}
