export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp, rateLimitError } from "@/lib/rate-limit";

type Body = {
  email?: string;
  source?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeSource(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length ? s.slice(0, 80) : "homepage";
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit({ key: `early-access:${ip}`, limit: 10, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return rateLimitError(rl.retryAfterSec);

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const email = normalizeEmail(body.email);
    const source = normalizeSource(body.source);

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Please provide a valid email address." },
        { status: 400 }
      );
    }

    await prisma.earlyAccessLead.upsert({
      where: { email },
      create: { email, source },
      update: { source },
    });

    return NextResponse.json({
      ok: true,
      message: "You’re in! We’ll email you when Early Access opens.",
    });
  } catch (err) {
    console.error("POST /api/early-access failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not join right now." },
      { status: 500 }
    );
  }
}
