import { sendEmail } from "@/lib/email";

export const ADMIN_ACTIVITY_EMAIL = "admin@truefantix.com";

export type AdminActivity =
  | "TICKETS_LISTED"
  | "TICKETS_PURCHASED"
  | "TICKETS_TRANSFERRED"
  | "TRANSFER_CONFIRMED"
  | "REMINDER_EMAIL_SENT";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character
  ));
}

export async function sendAdminActivityEmail(params: {
  activity: AdminActivity;
  summary: string;
  details: Record<string, string | number | null | undefined>;
}) {
  const completedAt = new Date().toISOString();
  const detailLines = Object.entries(params.details)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => `${label}: ${String(value)}`);
  const subject = `[TrueFanTix] ${params.summary}`;
  const text = `${params.summary}\n\nActivity: ${params.activity}\n${detailLines.join("\n")}\n\nCompleted: ${completedAt}`;
  const htmlDetails = detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  try {
    const result = await sendEmail({
      to: ADMIN_ACTIVITY_EMAIL,
      subject,
      text,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1f2937"><div style="background:#064a93;color:white;padding:18px 22px"><strong>${escapeHtml(params.summary)}</strong></div><div style="background:#f9fafb;padding:22px"><p><strong>Activity:</strong> ${escapeHtml(params.activity)}</p><ul>${htmlDetails}</ul><p style="color:#6b7280;font-size:12px">Completed: ${escapeHtml(completedAt)}</p></div></div>`,
    });
    if (!result.ok) console.error(`[EMAIL] Admin activity notification failed (${params.activity}):`, result.error);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown admin email error";
    console.error(`[EMAIL] Admin activity notification failed (${params.activity}):`, message);
    return { ok: false, error: message };
  }
}
