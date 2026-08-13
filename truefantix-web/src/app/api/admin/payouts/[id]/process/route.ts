export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { processStripePayout } from "@/lib/payouts/processStripePayout";

function payoutIdFromRequest(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("payouts");
  return index >= 0 ? decodeURIComponent(parts[index + 1] || "").trim() : "";
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const payoutId = payoutIdFromRequest(req);
  if (!payoutId) return NextResponse.json({ ok: false, error: "Payout ID is required." }, { status: 400 });

  const result = await processStripePayout(payoutId, { actorUserId: gate.user.id });
  if (result.ok) return NextResponse.json(result);
  const status = result.code === "NOT_FOUND" ? 404 : result.code === "STRIPE_FAILED" ? 502 : 409;
  return NextResponse.json({ ok: false, error: `PAYOUT_${result.code}`, message: result.message }, { status });
}
