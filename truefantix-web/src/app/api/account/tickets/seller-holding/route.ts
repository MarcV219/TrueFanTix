export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { getSellerHoldingOrders } from "@/lib/accountSellerHolding";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const orders = await getSellerHoldingOrders(gate.user.id);
    return NextResponse.json({ ok: true, orders }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/account/tickets/seller-holding error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load seller holding orders." },
      { status: 500 }
    );
  }
}
