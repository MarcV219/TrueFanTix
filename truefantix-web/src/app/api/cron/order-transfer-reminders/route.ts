export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { runTransferReminderWorkflow } from "@/lib/orders/transferWorkflow";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const internalCron = hasInternalCronAuth(req);
  if (!internalCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    const result = await runTransferReminderWorkflow(startedAt);
    await recordSchedulerRun("SUCCESS", startedAt, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await recordSchedulerRun("FAILED", startedAt, {
      error: error instanceof Error ? error.message : "Unknown scheduler failure",
    }).catch(() => undefined);
    throw error;
  }
}

export async function GET(req: Request) {
  return POST(req);
}

async function recordSchedulerRun(status: "SUCCESS" | "FAILED", startedAt: Date, result: unknown) {
  await prisma.auditLog.create({
    data: {
      action: "TRANSFER_REMINDER_SCHEDULER_RUN",
      targetType: "Scheduler",
      targetId: "order-transfer-reminders",
      metadata: JSON.stringify({ status, startedAt: startedAt.toISOString(), result }),
    },
  });
}
