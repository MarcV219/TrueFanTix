import { NextResponse } from "next/server";
import { getPrimaryPreflight } from "@/lib/primary/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const preflight = getPrimaryPreflight();
  if (!preflight.ready) {
    // A disabled or misconfigured feature is deliberately indistinguishable
    // from an absent route to public callers.
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    feature: "primary-ticketing",
    environment: preflight.environmentId,
  });
}
