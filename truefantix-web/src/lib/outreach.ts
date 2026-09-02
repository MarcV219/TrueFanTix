import crypto from "crypto";

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
export function outreachOrigin() {
  const value = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(value).origin;
}
function signingKey() {
  const secret = process.env.OUTREACH_UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("OUTREACH_UNSUBSCRIBE_SECRET or SESSION_SECRET must be at least 32 characters.");
  return secret;
}
export function unsubscribeToken(email: string) {
  const encoded = Buffer.from(normalizeEmail(email), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", signingKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
export function emailFromUnsubscribeToken(token: string) {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = crypto.createHmac("sha256", signingKey()).update(encoded).digest("base64url");
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const email = normalizeEmail(Buffer.from(encoded, "base64url").toString("utf8")); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null; } catch { return null; }
}
export function unsubscribeUrl(email: string) { return `${outreachOrigin()}/unsubscribe/outreach?token=${encodeURIComponent(unsubscribeToken(email))}`; }
export function contactMergeVars(contact: { contactName?: string | null; subjectName?: string | null; organization?: string | null; role?: string | null; email?: string | null }) {
  const firstName = (contact.contactName || "").trim().split(/\s+/)[0] || "there";
  return { firstName, contactName: contact.contactName || "", subjectName: contact.subjectName || "", organization: contact.organization || "", role: contact.role || "", email: contact.email || "" };
}
export function renderMerge(value: string, vars: Record<string, string | null | undefined>) {
  return value.replace(/{{\s*([a-zA-Z][\w]*)\s*}}/g, (_match, key) => vars[key] || "");
}
