export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import {
  spotifyAccountRedirectUrl,
  spotifyAuthorizeUrl,
  spotifyConfigured,
} from "@/lib/integrations/spotify";
import {
  ManagedAccountSpotifyOperationError,
  runOrdinarySpotifyOperation,
} from "@/lib/integrations/ordinary-spotify-user";

const STATE_COOKIE = "tft_spotify_oauth_state";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function clearState(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return privateResponse(response);
}

function stagingConsoleOnlyError() {
  return clearState(NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403 },
  ));
}

export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return clearState(gate.res);

    await runOrdinarySpotifyOperation(gate.user.id, async () => undefined);

    if (!spotifyConfigured()) {
      return clearState(NextResponse.redirect(spotifyAccountRedirectUrl("not_configured")));
    }

    const state = crypto.randomBytes(24).toString("hex");
    const res = NextResponse.redirect(spotifyAuthorizeUrl(state));
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return privateResponse(res);
  } catch (error) {
    if (error instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    console.error("Spotify authorization start failed");
    return clearState(NextResponse.json(
      { ok: false, error: "SPOTIFY_START_FAILED", message: "Could not start Spotify authorization." },
      { status: 500 },
    ));
  }
}
