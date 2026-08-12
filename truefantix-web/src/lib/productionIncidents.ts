import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ADMIN_ACTIVITY_EMAIL } from "@/lib/adminActivityEmail";
import { sendEmail } from "@/lib/email";

type IncidentInput = {
  category: "APPLICATION" | "DATABASE" | "STRIPE_WEBHOOK" | "REMINDER_SCHEDULER" | "EXTERNAL_WATCHDOG";
  severity: "WARNING" | "ERROR" | "CRITICAL";
  summary: string;
  error?: unknown;
  references?: Record<string, string | number | boolean | null | undefined>;
  fingerprint?: string;
};

const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function clean(value: string, max = 800) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

export async function reportProductionIncident(input: IncidentInput) {
  const now = new Date();
  const errorMessage = input.error instanceof Error ? input.error.message : input.error ? String(input.error) : "";
  const safeDetails = JSON.stringify({
    error: clean(errorMessage),
    references: Object.fromEntries(Object.entries(input.references || {}).filter(([, value]) => value !== undefined)),
  });
  const fingerprint = createHash("sha256")
    .update(input.fingerprint || `${input.category}:${input.summary}:${clean(errorMessage, 200)}`)
    .digest("hex");

  try {
    const incident = await prisma.productionIncident.upsert({
      where: { fingerprint },
      create: { fingerprint, category: input.category, severity: input.severity, summary: clean(input.summary, 240), safeDetails },
      update: { severity: input.severity, summary: clean(input.summary, 240), safeDetails, status: "OPEN", resolvedAt: null, resolvedById: null, lastSeenAt: now, occurrenceCount: { increment: 1 } },
    });

    const alertBefore = new Date(now.getTime() - ALERT_COOLDOWN_MS);
    const claimed = await prisma.productionIncident.updateMany({
      where: { id: incident.id, OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lte: alertBefore } }] },
      data: { lastAlertedAt: now },
    });
    if (!claimed.count) return incident;

    const details = JSON.parse(safeDetails) as { error?: string; references?: Record<string, unknown> };
    const refs = Object.entries(details.references || {}).map(([key, value]) => `${key}: ${String(value)}`).join("\n");
    const text = `${input.severity} production incident\n\n${input.summary}\n${details.error ? `Error: ${details.error}\n` : ""}${refs}\n\nIncident: ${incident.id}\nOccurrences: ${incident.occurrenceCount}`;
    await sendEmail({
      to: ADMIN_ACTIVITY_EMAIL,
      subject: `[TrueFanTix ${input.severity}] ${clean(input.summary, 120)}`,
      text,
      html: `<div style="font-family:Arial,sans-serif"><h2>${input.severity} production incident</h2><p>${escapeHtml(clean(input.summary, 240))}</p><pre style="white-space:pre-wrap">${escapeHtml(clean(text, 1800))}</pre></div>`,
    });
    return incident;
  } catch (reportingError) {
    console.error("[INCIDENT] Failed to record production incident:", reportingError);
    return null;
  }
}
