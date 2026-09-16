export const runtime = "nodejs";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import {
  exchangeSpotifyCode,
  getSpotifyConnectionEvidence,
  snapshotSpotifyConnectionAuthorization,
  spotifyAccountRedirectUrl,
  storeSpotifyConnection,
  type SpotifyConnectionAuthorization,
} from "@/lib/integrations/spotify";
import {
  ManagedAccountSpotifyOperationError,
  runOrdinarySpotifyTransaction,
} from "@/lib/integrations/ordinary-spotify-user";

const STATE_COOKIE = "tft_spotify_oauth_state";

function redirect(status: string) {
  const response = NextResponse.redirect(spotifyAccountRedirectUrl(status));
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
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
  response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) {
    gate.res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return gate.res;
  }

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return redirect("denied");

  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirect("invalid_state");
  }

  try {
    const authorization = await runOrdinarySpotifyTransaction<SpotifyConnectionAuthorization>(
      gate.user.id,
      (tx) => snapshotSpotifyConnectionAuthorization(gate.user.id, tx),
    );

    const token = await exchangeSpotifyCode(code);
    const evidence = await getSpotifyConnectionEvidence(token);

    await runOrdinarySpotifyTransaction(gate.user.id, (tx) => {
      return storeSpotifyConnection({ authorization, evidence, db: tx });
    });
    return redirect("connected");
  } catch (err) {
    if (err instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    console.error("Spotify callback failed:", err);
    return redirect("failed");
  }
}
