export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { spotifyAuthorizeUrl, spotifyConfigured } from "@/lib/integrations/spotify";

const STATE_COOKIE = "tft_spotify_oauth_state";

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) return gate.res;

  if (!spotifyConfigured()) {
    return NextResponse.redirect(new URL("/account/notifications?spotify=not_configured", req.url));
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
  return res;
}
