export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { getBuyerTickets } from "@/lib/accountTickets";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const tickets = await getBuyerTickets(gate.user.id, ["PAID", "DELIVERED"]);
    return NextResponse.json({ ok: true, tickets }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/account/tickets/holding error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load holding tickets." },
      { status: 500 }
    );
  }
}
