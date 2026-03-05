export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyRateLimit, rateLimitError } from "@/lib/rate-limit";
import { schemas, validateRequest } from "@/lib/validation";

function normalizeSource(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length ? s.slice(0, 80) : "homepage";
}

export async function POST(req: Request) {
  try {
    const rlResult = await applyRateLimit(req, "DEFAULT_UNAUTH_READ");
    if (!rlResult.ok) return rlResult.response;

    // Validate request body with Zod
    const validation = await validateRequest(schemas.earlyAccessSignup)(req);
    if (!validation.success) {
      return validation.response;
    }

    const { email } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();
    const source = normalizeSource(validation.data.source);

    await prisma.earlyAccessLead.upsert({
      where: { email: normalizedEmail },
      create: { email: normalizedEmail, source },
      update: { source },
    });

    return NextResponse.json({
      ok: true,
      message: "You're in! We'll email you when Early Access opens.",
    });
  } catch (err) {
    console.error("POST /api/early-access failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not join right now." },
      { status: 500 }
    );
  }
}
