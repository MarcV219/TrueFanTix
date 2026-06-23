export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireDebugAccess } from "@/lib/security/debug-access";

export async function POST(req: Request) {
  const debugGate = requireDebugAccess(req);
  if (!debugGate.ok) return debugGate.res;

  return NextResponse.json(
    {
      ok: false,
      error: "TICKET_SEEDING_DISABLED",
      message: "Ticket seeding is disabled. Create tickets through the seller listing flow.",
    },
    { status: 410 },
  );
}
