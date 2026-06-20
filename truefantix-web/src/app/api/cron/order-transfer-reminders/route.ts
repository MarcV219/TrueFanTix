export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { runTransferReminderWorkflow } from "@/lib/orders/transferWorkflow";

export async function POST(req: Request) {
  const internalCron = hasInternalCronAuth(req);
  if (!internalCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runTransferReminderWorkflow(new Date());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return POST(req);
}
