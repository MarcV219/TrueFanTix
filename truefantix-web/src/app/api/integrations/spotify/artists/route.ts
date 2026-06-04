export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import { getSpotifyImportCandidates } from "@/lib/integrations/spotify";

const ADMIN_EMAIL = "admin@truefantix.com";

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

async function notifyAdminOfUnmatched({
  user,
  names,
}: {
  user: { id: string; email: string; firstName: string; lastName: string };
  names: string[];
}) {
  if (names.length === 0) return;
  const subject = `Spotify catalog requests: ${names.length} artist${names.length === 1 ? "" : "s"}`;
  const text = `A TrueFanTix user imported Spotify artists that need catalog review.

User: ${user.firstName} ${user.lastName} <${user.email}>
User ID: ${user.id}

Artists:
${names.map((name) => `- ${name}`).join("\n")}

Review pending catalog requests in /admin/catalog-requests and fulfill them to add the artists to the user's notification favorites.`;

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
  <h2>Spotify catalog requests</h2>
  <p>A TrueFanTix user imported Spotify artists that need catalog review.</p>
  <p><strong>User:</strong> ${user.firstName} ${user.lastName} &lt;${user.email}&gt;</p>
  <p><strong>User ID:</strong> ${user.id}</p>
  <ul>${names.map((name) => `<li>${name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</li>`).join("")}</ul>
  <p>Review pending catalog requests in <code>/admin/catalog-requests</code> and fulfill them to add the artists to the user's notification favorites.</p>
</body>
</html>`;

  const result = await sendEmail({ to: ADMIN_EMAIL, subject, text, html });
  if (!result.ok) console.error("Spotify unmatched artist admin email failed:", result.error);
}

export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const result = await getSpotifyImportCandidates(gate.user.id);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error("GET /api/integrations/spotify/artists failed:", err);
    return NextResponse.json(
      { ok: false, error: "SPOTIFY_IMPORT_FAILED", message: "Could not load Spotify artists." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const body = await req.json().catch(() => null);
    const selectedIds = Array.isArray(body?.spotifyIds)
      ? new Set(body.spotifyIds.map((id: unknown) => String(id)))
      : null;
    const includeUnmatched = body?.includeUnmatched !== false;

    const result = await getSpotifyImportCandidates(gate.user.id);
    if (!result.connected) {
      return NextResponse.json(
        { ok: false, error: "SPOTIFY_NOT_CONNECTED", message: "Connect Spotify before importing artists." },
        { status: 400 }
      );
    }

    const selected = result.artists.filter((artist) => !selectedIds || selectedIds.has(artist.spotifyId));
    const imported = [];
    const requested = [];

    for (const artist of selected) {
      const name = normalizeValue(artist.name);
      if (!name) continue;

      if (artist.match?.catalogEntityId) {
        const entity = await prisma.catalogEntity.findUnique({
          where: { id: artist.match.catalogEntityId },
          select: { id: true, type: true, canonicalName: true },
        });
        if (!entity || entity.type !== "ARTIST") continue;

        const preference = await prisma.notificationPreference.upsert({
          where: {
            userId_type_value: {
              userId: gate.user.id,
              type: "ARTIST",
              value: entity.canonicalName,
            },
          },
          create: {
            userId: gate.user.id,
            type: "ARTIST",
            value: entity.canonicalName,
            catalogEntityId: entity.id,
            status: "ACTIVE",
          },
          update: {
            catalogEntityId: entity.id,
            status: "ACTIVE",
          },
          select: { id: true, type: true, value: true, status: true, catalogEntityId: true },
        });
        imported.push(preference);
      } else if (includeUnmatched) {
        const request = await prisma.catalogRequest.upsert({
          where: {
            userId_requestedType_requestedValue: {
              userId: gate.user.id,
              requestedType: "ARTIST",
              requestedValue: name,
            },
          },
          create: {
            userId: gate.user.id,
            requestedType: "ARTIST",
            requestedValue: name,
            notes: "Imported from Spotify; needs catalog review.",
            status: "PENDING",
          },
          update: {
            notes: "Imported from Spotify; needs catalog review.",
            status: "PENDING",
            adminNotes: null,
            reviewedAt: null,
          },
          select: { id: true, requestedValue: true, status: true },
        });
        requested.push(request);
      }
    }

    await notifyAdminOfUnmatched({
      user: {
        id: gate.user.id,
        email: gate.user.email,
        firstName: gate.user.firstName,
        lastName: gate.user.lastName,
      },
      names: requested.map((request) => request.requestedValue),
    });

    return NextResponse.json({ ok: true, imported, requested }, { status: 200 });
  } catch (err) {
    console.error("POST /api/integrations/spotify/artists failed:", err);
    return NextResponse.json(
      { ok: false, error: "SPOTIFY_IMPORT_FAILED", message: "Could not import Spotify artists." },
      { status: 500 }
    );
  }
}
