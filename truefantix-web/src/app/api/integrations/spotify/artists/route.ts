export const runtime = "nodejs";

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import {
  sendEmail,
  type EmailPayload,
  type EmailSendResult,
} from "@/lib/email";
import { getSpotifyImportCandidates } from "@/lib/integrations/spotify";
import {
  ManagedAccountSpotifyOperationError,
  runOrdinarySpotifyOperation,
} from "@/lib/integrations/ordinary-spotify-user";

const ADMIN_EMAIL = "admin@truefantix.com";

async function sendEmailWithProviderEvidence(
  payload: EmailPayload,
): Promise<EmailSendResult> {
  try {
    return await sendEmail(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    return {
      ok: false,
      provider: "CONSOLE",
      providerResult: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE",
      error: `EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: ${message}`,
    };
  }
}

function stagingConsoleOnlyError() {
  const response = NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

async function notifyAdminOfUnmatched({
  user,
  names,
  requestIds,
}: {
  user: { id: string; email: string; firstName: string; lastName: string };
  names: string[];
  requestIds: string[];
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

  const requestIdentity = [...new Set(requestIds)].sort().join("\n");
  const idempotencyKey = `spotify-catalog:${createHash("sha256")
    .update(`${user.id}\n${requestIdentity}`)
    .digest("hex")}`;
  const result = await sendEmailWithProviderEvidence({
    to: ADMIN_EMAIL,
    subject,
    text,
    html,
    idempotencyKey,
  });
  if (!result.ok) console.error("Spotify unmatched artist admin email failed:", result.error);
}

export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const result = await runOrdinarySpotifyOperation(gate.user.id, (tx) =>
      getSpotifyImportCandidates(gate.user.id, tx),
    );
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    if (err instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
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

    const result = await runOrdinarySpotifyOperation(gate.user.id, async (tx) => {
      const result = await getSpotifyImportCandidates(gate.user.id, tx);
      if (!result.connected) {
        return { connected: false as const, imported: [], requested: [] };
      }

      const selected = result.artists.filter((artist) => !selectedIds || selectedIds.has(artist.spotifyId));
      const imported = [];
      const requested = [];

      for (const artist of selected) {
        const name = normalizeValue(artist.name);
        if (!name) continue;

        if (artist.match?.catalogEntityId) {
          const entity = await tx.catalogEntity.findUnique({
            where: { id: artist.match.catalogEntityId },
            select: { id: true, type: true, canonicalName: true },
          });
          if (!entity || entity.type !== "ARTIST") continue;

          const preference = await tx.notificationPreference.upsert({
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
          const request = await tx.catalogRequest.upsert({
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

      return { connected: true as const, imported, requested };
    });

    if (!result.connected) {
      return NextResponse.json(
        { ok: false, error: "SPOTIFY_NOT_CONNECTED", message: "Connect Spotify before importing artists." },
        { status: 400 },
      );
    }

    await notifyAdminOfUnmatched({
      user: {
        id: gate.user.id,
        email: gate.user.email,
        firstName: gate.user.firstName,
        lastName: gate.user.lastName,
      },
      names: result.requested.map((request) => request.requestedValue),
      requestIds: result.requested.map((request) => request.id),
    });

    return NextResponse.json(
      { ok: true, imported: result.imported, requested: result.requested },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    console.error("POST /api/integrations/spotify/artists failed:", err);
    return NextResponse.json(
      { ok: false, error: "SPOTIFY_IMPORT_FAILED", message: "Could not import Spotify artists." },
      { status: 500 }
    );
  }
}
