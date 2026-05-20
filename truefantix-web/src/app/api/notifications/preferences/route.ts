export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

// GET /api/notifications/preferences
// Get a user's notification preferences
export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }

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
    const gate = await requireUser(req);
    if (!gate.user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    const validation = await validateRequest(schemas.notificationPreferenceCreateApi)(req);
    if (!validation.success) return validation.response;

    const { type, value } = validation.data;

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
    const gate = await requireUser(req);
    if (!gate.user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    const validation = await validateRequest(schemas.notificationPreferenceDeleteApi)(req);
    if (!validation.success) return validation.response;

    const { id } = validation.data;

    // Ensure user owns the preference before deleting
    const preference = await prisma.notificationPreference.findUnique({
      where: { id },
    });

    if (!preference || preference.userId !== gate.user.id) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Preference not found or not owned by user." }, { status: 404 });
    }

    await prisma.notificationPreference.delete({
      where: { id },
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
