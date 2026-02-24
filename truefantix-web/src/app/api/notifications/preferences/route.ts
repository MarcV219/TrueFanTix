export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";

// Utility to normalize string inputs
function normalizeString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s.slice(0, 80) : null;
}

// GET /api/notifications/preferences
// Get a user's notification preferences
export async function GET(req: Request) {
  try {
    const gate = await requireUser();

    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: gate.user.id },
      select: {
        id: true,
        type: true,
        value: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ ok: true, preferences }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("GET /api/notifications/preferences failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not fetch preferences." }, { status: 500 });
  }
}

// POST /api/notifications/preferences
// Add a new notification preference
export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    const body = (await req.json().catch(() => null)) as {
      type?: string;
      value?: string;
    } | null;

    if (!body || !body.type || !body.value) {
      return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message: "Missing type or value." }, { status: 400 });
    }

    const type = normalizeString(body.type);
    const value = normalizeString(body.value);

    if (!type || !value) {
      return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message: "Invalid type or value." }, { status: 400 });
    }

    // Prevent duplicates with upsert
    const preference = await prisma.notificationPreference.upsert({
      where: { userId_type_value: { userId: gate.user.id, type, value } },
      create: { userId: gate.user.id, type, value, status: "ACTIVE" },
      update: { status: "ACTIVE" },
      select: { id: true, type: true, value: true, status: true, createdAt: true },
    });

    return NextResponse.json({ ok: true, preference }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("POST /api/notifications/preferences failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not add preference." }, { status: 500 });
  }
}

// DELETE /api/notifications/preferences
// Delete a notification preference by ID
export async function DELETE(req: Request) {
  try {
    const gate = await requireUser();
    const body = (await req.json().catch(() => null)) as {
      id?: string;
    } | null;

    if (!body || !body.id) {
      return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message: "Missing preference ID." }, { status: 400 });
    }

    // Ensure user owns the preference before deleting
    const preference = await prisma.notificationPreference.findUnique({
      where: { id: body.id },
    });

    if (!preference || preference.userId !== gate.user.id) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Preference not found or not owned by user." }, { status: 404 });
    }

    await prisma.notificationPreference.delete({
      where: { id: body.id },
    });

    return NextResponse.json({ ok: true, message: "Preference deleted." }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("DELETE /api/notifications/preferences failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not delete preference." }, { status: 500 });
  }
}
