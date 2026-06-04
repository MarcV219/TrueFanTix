export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { disconnectSpotify } from "@/lib/integrations/spotify";

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
