export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { runTransferReminderWorkflow } from "@/lib/orders/transferWorkflow";
import { drainTransferProofDeliveryIntents } from "@/lib/orders/transferProofDelivery";
import { drainTransferProofReviewDeliveryIntents } from "@/lib/orders/transferProofReviewDelivery";
import { recoverSpotifyCatalogRequestDeliveries } from "@/lib/integrations/spotify-catalog-request-delivery";
import { prisma } from "@/lib/prisma";
import { reportProductionIncident } from "@/lib/productionIncidents";

export async function POST(req: Request) {
  const internalCron = hasInternalCronAuth(req);
  if (!internalCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();

  try {
    // These are independent recovery domains. Always attempt every component so a
    // poisoned row or transient failure in one outbox cannot indefinitely
    // starve unrelated committed work in another.
    const transferProofDeliveries = await runSchedulerComponent(
      "transferProofDeliveries",
      () => drainTransferProofDeliveryIntents({ now: startedAt }),
    );
    const transferProofReviewDeliveries = await runSchedulerComponent(
      "transferProofReviewDeliveries",
      () => drainTransferProofReviewDeliveryIntents({ now: startedAt }),
    );
    const spotifyCatalogRequestDeliveries = await runSchedulerComponent(
      "spotifyCatalogRequestDeliveries",
      () => recoverSpotifyCatalogRequestDeliveries(),
    );
    const transferReminders = await runSchedulerComponent(
      "transferReminders",
      () => runTransferReminderWorkflow(startedAt),
    );
    const components = {
      transferProofDeliveries: schedulerComponentEvidence(transferProofDeliveries),
      transferProofReviewDeliveries: schedulerComponentEvidence(transferProofReviewDeliveries),
      spotifyCatalogRequestDeliveries: schedulerComponentEvidence(spotifyCatalogRequestDeliveries),
      transferReminders: schedulerComponentEvidence(transferReminders),
    };
    const failures = [
      transferProofDeliveries,
      transferProofReviewDeliveries,
      spotifyCatalogRequestDeliveries,
      transferReminders,
    ].filter((component): component is SchedulerComponentFailure => !component.ok);
    if (
      !transferProofDeliveries.ok
      || !transferProofReviewDeliveries.ok
      || !spotifyCatalogRequestDeliveries.ok
      || !transferReminders.ok
    ) {
      throw new AggregateError(
        failures.map((failure) => failure.cause),
        `Transfer reminder scheduler components failed: ${failures.map((failure) => failure.name).join(", ")}`,
        { cause: components },
      );
    }
    const result = {
      ...transferReminders.value,
      transferProofDeliveries: transferProofDeliveries.value,
      transferProofReviewDeliveries: transferProofReviewDeliveries.value,
      spotifyCatalogRequestDeliveries: spotifyCatalogRequestDeliveries.value,
    };
    await recordSchedulerRun("SUCCESS", startedAt, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const componentEvidence = error instanceof AggregateError
      && error.cause
      && typeof error.cause === "object"
      ? { components: error.cause }
      : {};
    await recordSchedulerRun("FAILED", startedAt, {
      error: error instanceof Error ? error.message : "Unknown scheduler failure",
      ...componentEvidence,
    }).catch(() => undefined);
    await reportProductionIncident({
      category: "REMINDER_SCHEDULER",
      severity: "CRITICAL",
      summary: "Transfer reminder scheduler failed",
      error,
      fingerprint: "reminder-scheduler-failed",
    });
    throw error;
  }
}

type SchedulerComponentSuccess<T> = {
  name: string;
  ok: true;
  value: T;
};

type SchedulerComponentFailure = {
  name: string;
  ok: false;
  error: string;
  cause: unknown;
};

type SchedulerComponentResult<T> = SchedulerComponentSuccess<T> | SchedulerComponentFailure;

async function runSchedulerComponent<T>(
  name: string,
  run: () => Promise<T>,
): Promise<SchedulerComponentResult<T>> {
  try {
    return { name, ok: true, value: await run() };
  } catch (cause) {
    return {
      name,
      ok: false,
      error: cause instanceof Error ? cause.message : "Unknown scheduler component failure",
      cause,
    };
  }
}

function schedulerComponentEvidence<T>(component: SchedulerComponentResult<T>) {
  return component.ok
    ? { status: "SUCCESS" as const, result: component.value }
    : { status: "FAILED" as const, error: component.error };
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
