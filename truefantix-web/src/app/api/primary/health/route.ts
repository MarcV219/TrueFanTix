import { NextResponse } from "next/server";
import { getPrimaryPreflight } from "@/lib/primary/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore<T extends NextResponse>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET() {
  const preflight = getPrimaryPreflight();
  if (!preflight.ready) {
    // A disabled or misconfigured feature is deliberately indistinguishable
    // from an absent route to public callers.
    return noStore(NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 }));
  }

  return noStore(NextResponse.json({
    ok: true,
    feature: "primary-ticketing",
    environment: preflight.environmentId,
  }));
}
