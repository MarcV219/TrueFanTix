export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { disconnectSpotify, hasSpotifyConnection } from "@/lib/integrations/spotify";
import {
  ManagedAccountSpotifyOperationError,
  runOrdinarySpotifyOperation,
} from "@/lib/integrations/ordinary-spotify-user";

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

export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const connected = await runOrdinarySpotifyOperation(gate.user.id, (tx) =>
      hasSpotifyConnection(gate.user.id, tx),
    );
    return NextResponse.json({ ok: true, connected }, { status: 200 });
  } catch (err) {
    if (err instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    console.error("GET /api/integrations/spotify/connection failed:", err);
    return NextResponse.json(
      { ok: false, error: "SPOTIFY_CONNECTION_STATUS_FAILED", message: "Could not check Spotify connection." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    await runOrdinarySpotifyOperation(gate.user.id, (tx) =>
      disconnectSpotify(gate.user.id, tx),
    );
    return NextResponse.json({ ok: true, message: "Spotify disconnected." }, { status: 200 });
  } catch (err) {
    if (err instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    console.error("DELETE /api/integrations/spotify/connection failed:", err);
    return NextResponse.json(
      { ok: false, error: "SPOTIFY_DISCONNECT_FAILED", message: "Could not disconnect Spotify." },
      { status: 500 }
    );
  }
}
