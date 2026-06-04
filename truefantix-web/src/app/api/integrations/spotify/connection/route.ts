export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { disconnectSpotify, hasSpotifyConnection } from "@/lib/integrations/spotify";

export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const connected = await hasSpotifyConnection(gate.user.id);
    return NextResponse.json({ ok: true, connected }, { status: 200 });
  } catch (err) {
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

    await disconnectSpotify(gate.user.id);
    return NextResponse.json({ ok: true, message: "Spotify disconnected." }, { status: 200 });
  } catch (err) {
    console.error("DELETE /api/integrations/spotify/connection failed:", err);
    return NextResponse.json(
      { ok: false, error: "SPOTIFY_DISCONNECT_FAILED", message: "Could not disconnect Spotify." },
      { status: 500 }
    );
  }
}
