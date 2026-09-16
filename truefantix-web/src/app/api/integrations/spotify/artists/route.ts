export const runtime = "nodejs";

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import {
  sendEmail,
  type EmailPayload,
  type EmailSendResult,
} from "@/lib/email";
import {
  importSpotifyArtistSnapshot,
  readSpotifyArtistSnapshot,
  type SpotifyArtistImportResult,
  type SpotifyArtistImportSelection,
  type SpotifyArtistReadResult,
} from "@/lib/integrations/spotify-artist-read";
import { SpotifyRefreshAccessChangedError } from "@/lib/integrations/spotify-refresh-command";
import { ManagedAccountSpotifyOperationError } from "@/lib/integrations/ordinary-spotify-user";

const ADMIN_EMAIL = "admin@truefantix.com";
const MAX_REQUEST_BYTES = 16_384;
const MAX_SELECTED_ARTISTS = 350;
const MAX_SPOTIFY_ID_LENGTH = 128;

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

function privateJson(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function stagingConsoleOnlyError() {
  return privateJson(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    403,
  );
}

async function boundedJsonBody(req: Request) {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  }
  if (!req.body) throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  }
}

async function parseSelection(req: Request): Promise<SpotifyArtistImportSelection> {
  const body = await boundedJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  }
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some((key) => key !== "spotifyIds" && key !== "includeUnmatched")) {
    throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  }
  if (row.includeUnmatched !== undefined && typeof row.includeUnmatched !== "boolean") {
    throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  }

  let spotifyIds: readonly string[] | null = null;
  if (row.spotifyIds !== undefined) {
    if (!Array.isArray(row.spotifyIds) || row.spotifyIds.length > MAX_SELECTED_ARTISTS) {
      throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
    }
    const unique = new Set<string>();
    for (const value of row.spotifyIds) {
      if (typeof value !== "string") throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
      const normalized = value.trim();
      if (!normalized || normalized.length > MAX_SPOTIFY_ID_LENGTH) {
        throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
      }
      unique.add(normalized);
    }
    spotifyIds = Object.freeze([...unique]);
  }
  return Object.freeze({ spotifyIds, includeUnmatched: row.includeUnmatched !== false });
}

async function notifyAdminOfUnmatched({
  names,
  requestIds,
}: {
  names: string[];
  requestIds: string[];
}) {
  if (names.length === 0) return;
  const subject = `Spotify catalog requests: ${names.length} artist${names.length === 1 ? "" : "s"}`;
  const text = `A TrueFanTix user imported Spotify artists that need catalog review.

Artists:
${names.map((name) => `- ${name}`).join("\n")}

Review pending catalog requests in /admin/catalog-requests and fulfill them to add the artists to the user's notification favorites.`;

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
  <h2>Spotify catalog requests</h2>
  <p>A TrueFanTix user imported Spotify artists that need catalog review.</p>
  <ul>${names.map((name) => `<li>${name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</li>`).join("")}</ul>
  <p>Review pending catalog requests in <code>/admin/catalog-requests</code> and fulfill them to add the artists to the user's notification favorites.</p>
</body>
</html>`;

  const requestIdentity = [...new Set(requestIds)].sort().join("\n");
  const idempotencyKey = `spotify-catalog:${createHash("sha256")
    .update(requestIdentity)
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

function accessChangedError(error: SpotifyRefreshAccessChangedError) {
  if (error.code === "BANNED") {
    return privateJson({ ok: false, error: "BANNED", message: "This account is restricted." }, 403);
  }
  if (error.code === "NOT_VERIFIED") {
    return privateJson(
      { ok: false, error: "NOT_VERIFIED", message: "Please verify your email and phone number." },
      403,
    );
  }
  return privateJson({ ok: false, error: "NOT_AUTHENTICATED", message: "Please log in." }, 401);
}

function transientResult(result: SpotifyArtistReadResult | SpotifyArtistImportResult, post: boolean) {
  if (result.status === "NO_CONNECTION") {
    return post
      ? privateJson(
          { ok: false, error: "SPOTIFY_NOT_CONNECTED", message: "Connect Spotify before importing artists." },
          400,
        )
      : privateJson({ ok: true, connected: false, artists: [] }, 200);
  }
  if (result.status === "IN_PROGRESS") {
    return privateJson(
      { ok: false, error: "SPOTIFY_REFRESH_IN_PROGRESS", message: "Spotify is refreshing. Try again shortly." },
      409,
    );
  }
  if (result.status === "RECONNECT_REQUIRED") {
    return privateJson(
      { ok: false, error: "SPOTIFY_RECONNECT_REQUIRED", message: "Reconnect Spotify before continuing." },
      409,
    );
  }
  if (result.status === "DRIFTED") {
    return privateJson(
      { ok: false, error: "SPOTIFY_RETRY_REQUIRED", message: "Spotify changed while loading. Try again." },
      409,
    );
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return privateResponse(gate.res);

    const result = await readSpotifyArtistSnapshot(gate.user.id);
    const transient = transientResult(result, false);
    if (transient) return transient;
    if (result.status !== "READY") throw new Error("SPOTIFY_ARTIST_RESULT_INVALID");
    return privateJson({ ok: true, connected: true, artists: result.artists }, 200);
  } catch (error) {
    if (error instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    if (error instanceof SpotifyRefreshAccessChangedError) return accessChangedError(error);
    console.error("GET /api/integrations/spotify/artists failed");
    return privateJson(
      { ok: false, error: "SPOTIFY_IMPORT_FAILED", message: "Could not load Spotify artists." },
      500,
    );
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return privateResponse(gate.res);

    const selection = await parseSelection(req);
    const result = await importSpotifyArtistSnapshot(gate.user.id, selection);
    const transient = transientResult(result, true);
    if (transient) return transient;
    if (result.status !== "READY") throw new Error("SPOTIFY_ARTIST_RESULT_INVALID");

    await notifyAdminOfUnmatched({
      names: result.requested.map((request) => request.requestedValue),
      requestIds: result.requested.map((request) => request.id),
    });

    return privateJson(
      { ok: true, imported: result.imported, requested: result.requested },
      200,
    );
  } catch (error) {
    if (error instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    if (error instanceof SpotifyRefreshAccessChangedError) return accessChangedError(error);
    if (error instanceof Error && error.message === "SPOTIFY_ARTIST_SELECTION_INVALID") {
      return privateJson(
        { ok: false, error: "INVALID_REQUEST", message: "Invalid Spotify artist selection." },
        400,
      );
    }
    if (error instanceof Error && error.message === "SPOTIFY_ARTIST_SELECTION_STALE") {
      return privateJson(
        { ok: false, error: "SPOTIFY_SELECTION_STALE", message: "Refresh Spotify artists and try again." },
        409,
      );
    }
    console.error("POST /api/integrations/spotify/artists failed");
    return privateJson(
      { ok: false, error: "SPOTIFY_IMPORT_FAILED", message: "Could not import Spotify artists." },
      500,
    );
  }
}
