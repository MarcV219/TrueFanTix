export const runtime = "nodejs";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { exchangeSpotifyCode, storeSpotifyConnection } from "@/lib/integrations/spotify";
import {
  ManagedAccountSpotifyOperationError,
  runOrdinarySpotifyOperation,
} from "@/lib/integrations/ordinary-spotify-user";

const STATE_COOKIE = "tft_spotify_oauth_state";

function redirect(req: Request, status: string) {
  return NextResponse.redirect(new URL(`/account/notifications?spotify=${encodeURIComponent(status)}`, req.url));
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
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return redirect(req, "denied");

  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    const res = redirect(req, "invalid_state");
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  try {
    await runOrdinarySpotifyOperation(gate.user.id, async (tx) => {
      const token = await exchangeSpotifyCode(code);
      await storeSpotifyConnection({ userId: gate.user.id, token, db: tx });
    });
    const res = redirect(req, "connected");
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    if (err instanceof ManagedAccountSpotifyOperationError) return stagingConsoleOnlyError();
    console.error("Spotify callback failed:", err);
    const res = redirect(req, "failed");
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
}
