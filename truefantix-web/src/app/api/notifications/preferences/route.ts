export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
import {
  ManagedAccountNotificationPreferenceWriteError,
  runOrdinaryNotificationPreferenceWrite,
} from "@/lib/notifications/ordinary-preference-user";

function stagingConsoleOnlyResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

// GET /api/notifications/preferences
// Get a user's notification preferences
export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: gate.user.id },
      select: {
        id: true,
        type: true,
        value: true,
        status: true,
        createdAt: true,
        catalogEntityId: true,
        catalogEntity: {
          select: {
            id: true,
            provider: true,
            providerId: true,
            canonicalName: true,
            subtitle: true,
            aliases: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const settings = await prisma.user.findUnique({
      where: { id: gate.user.id },
      select: { notificationRadiusKm: true, notificationRadiusUnit: true },
    });

    return NextResponse.json(
      {
        ok: true,
        preferences,
        settings: {
          notificationRadiusKm: settings?.notificationRadiusKm ?? null,
          notificationRadiusUnit: settings?.notificationRadiusUnit === "MI" ? "MI" : "KM",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("GET /api/notifications/preferences failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not fetch preferences." }, { status: 500 });
  }
}

// PATCH /api/notifications/preferences
// Update notification matching settings
export async function PATCH(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;
    const validation = await validateRequest(schemas.notificationPreferencesSettingsApi)(req);
    if (!validation.success) return validation.response;

    const user = await runOrdinaryNotificationPreferenceWrite(gate.user.id, (tx) =>
      tx.user.update({
        where: { id: gate.user.id },
        data: {
          notificationRadiusKm: validation.data.notificationRadiusKm,
          notificationRadiusUnit: validation.data.notificationRadiusUnit ?? "KM",
        },
        select: { notificationRadiusKm: true, notificationRadiusUnit: true },
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        settings: {
          notificationRadiusKm: user.notificationRadiusKm,
          notificationRadiusUnit: user.notificationRadiusUnit === "MI" ? "MI" : "KM",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof ManagedAccountNotificationPreferenceWriteError) {
      return stagingConsoleOnlyResponse();
    }
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("PATCH /api/notifications/preferences failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not update notification settings." }, { status: 500 });
  }
}

// POST /api/notifications/preferences
// Add a new notification preference
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;
    const validation = await validateRequest(schemas.notificationPreferenceCreateApi)(req);
    if (!validation.success) return validation.response;

    const requestedType = validation.data.type;
    let type = requestedType;
    let value = validation.data.value;
    const catalogEntityId = validation.data.catalogEntityId ?? null;

    const result = await runOrdinaryNotificationPreferenceWrite(gate.user.id, async (tx) => {
      if (catalogEntityId) {
        const entity = await tx.catalogEntity.findUnique({ where: { id: catalogEntityId } });
        if (!entity) return { error: "CATALOG_ENTITY_NOT_FOUND" as const };
        if (entity.type !== requestedType) return { error: "CATALOG_TYPE_MISMATCH" as const };
        type = entity.type;
        value = entity.canonicalName;
      }

      // Prevent duplicates with upsert.
      const preference = await tx.notificationPreference.upsert({
        where: { userId_type_value: { userId: gate.user.id, type, value } },
        create: { userId: gate.user.id, type, value, catalogEntityId, status: "ACTIVE" },
        update: { catalogEntityId, status: "ACTIVE" },
        select: { id: true, type: true, value: true, status: true, createdAt: true, catalogEntityId: true },
      });
      return { preference };
    });

    if ("error" in result) {
      return result.error === "CATALOG_ENTITY_NOT_FOUND"
        ? NextResponse.json(
            { ok: false, error: result.error, message: "Choose a valid catalog suggestion before adding it." },
            { status: 400 },
          )
        : NextResponse.json(
            { ok: false, error: result.error, message: "The selected catalog suggestion does not match this preference type." },
            { status: 400 },
          );
    }

    return NextResponse.json({ ok: true, preference: result.preference }, { status: 201 });
  } catch (err) {
    if (err instanceof ManagedAccountNotificationPreferenceWriteError) {
      return stagingConsoleOnlyResponse();
    }
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
    if (!gate.ok) return gate.res;
    const validation = await validateRequest(schemas.notificationPreferenceDeleteApi)(req);
    if (!validation.success) return validation.response;

    const { id } = validation.data;

    const deleted = await runOrdinaryNotificationPreferenceWrite(gate.user.id, async (tx) => {
      // Keep ownership validation and deletion in the same transaction.
      const preference = await tx.notificationPreference.findUnique({ where: { id } });
      if (!preference || preference.userId !== gate.user.id) return false;
      await tx.notificationPreference.delete({ where: { id } });
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Preference not found or not owned by user." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: "Preference deleted." }, { status: 200 });
  } catch (err) {
    if (err instanceof ManagedAccountNotificationPreferenceWriteError) {
      return stagingConsoleOnlyResponse();
    }
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." }, { status: 401 });
    }
    console.error("DELETE /api/notifications/preferences failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not delete preference." }, { status: 500 });
  }
}
