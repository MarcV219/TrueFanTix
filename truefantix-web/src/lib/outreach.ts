import crypto from "crypto";

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
const GENERIC_OUTREACH_MAILBOXES = new Set([
  "admin", "administration", "athletic.office", "athletic.tickets", "athletics",
  "athtickets", "booking", "bookings", "boxoffice", "business", "community",
  "communications", "contact", "corporate", "customerservice", "enquiries",
  "events", "fanservices", "general", "groups", "group.sales", "hello", "hospitality",
  "info", "inquiries", "management", "manager", "marketing", "media", "membership",
  "memberships", "mgmt", "office", "partnership", "partnerships", "press", "presse",
  "premium", "premium.sales", "reception", "sales", "season.tickets", "seasontickets",
  "service", "sponsorship", "sponsorships", "support", "ticket", "ticketing",
  "ticketoffice", "tickets",
]);

/** True when an address identifies a department/role rather than an individual. */
export function isGenericOutreachEmail(value: string | null | undefined) {
  if (!value) return false;
  const localPart = normalizeEmail(value).split("@", 1)[0]
    .replace(/[+_-]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
  if (GENERIC_OUTREACH_MAILBOXES.has(localPart)) return true;
  const firstSegment = localPart.split(".")[0];
  return GENERIC_OUTREACH_MAILBOXES.has(firstSegment);
}

export function outreachContactLabel(contact: { contactName?: string | null; email?: string | null }) {
  const contactName = (contact.contactName || "").trim();
  if (contactName) return contactName;
  return contact.email && !isGenericOutreachEmail(contact.email)
    ? "Individual contact (name not published)"
    : "Departmental contact";
}
export const OUTREACH_RECENT_CONTACT_DAYS = 30;
export const OUTREACH_DEFAULT_FOLLOW_UP_DAYS = 45;
export function recentContactCutoff(now = new Date()) {
  return new Date(now.getTime() - OUTREACH_RECENT_CONTACT_DAYS * 24 * 60 * 60 * 1000);
}
export function defaultOutreachFollowUpAt(sentAt = new Date()) {
  return new Date(sentAt.getTime() + OUTREACH_DEFAULT_FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);
}
export function wasRecentlyContacted(value: Date | string | null | undefined, now = new Date()) {
  return Boolean(value && new Date(value).getTime() >= recentContactCutoff(now).getTime());
}
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
  // A staff directory can identify a person near a shared departmental address
  // without establishing that the inbox belongs to that person. Never personalize
  // a message to an individual unless the address itself is person-level.
  const contactName = isGenericOutreachEmail(contact.email) ? "" : (contact.contactName || "").trim();
  const firstName = contactName.split(/\s+/)[0] || "there";
  const subjectName = contact.subjectName || "";
  return {
    firstName,
    contactName,
    subjectName,
    // Sports imports may identify a league or venue as the contact's employer.
    // Campaigns are addressed to the team/artist itself, which is subjectName.
    organization: subjectName || contact.organization || "",
    role: contact.role || "",
    email: contact.email || "",
  };
}
export function renderMerge(value: string, vars: Record<string, string | null | undefined>) {
  const organization = String(vars.organization || "").trim();
  const organizationPossessive = organization
    ? `${organization}${/s$/i.test(organization) ? "’" : "’s"}`
    : "";
  return value
    // Existing templates use {{organization}}’s. Resolve the complete phrase
    // first so names ending in s become "Sceptres’", not "Sceptres’s".
    .replace(/{{\s*organization\s*}}(?:’s|'s)/gi, organizationPossessive)
    .replace(/{{\s*([a-zA-Z][\w]*)\s*}}/g, (_match, key) => vars[key] || "");
}
