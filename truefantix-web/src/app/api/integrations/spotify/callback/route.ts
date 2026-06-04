export const runtime = "nodejs";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { exchangeSpotifyCode, storeSpotifyConnection } from "@/lib/integrations/spotify";

const STATE_COOKIE = "tft_spotify_oauth_state";

function redirect(req: Request, status: string) {
  return NextResponse.redirect(new URL(`/account/notifications?spotify=${encodeURIComponent(status)}`, req.url));
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
    const token = await exchangeSpotifyCode(code);
    await storeSpotifyConnection({ userId: gate.user.id, token });
    const res = redirect(req, "connected");
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("Spotify callback failed:", err);
    const res = redirect(req, "failed");
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
}
