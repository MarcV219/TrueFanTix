export const SITE_URL = "https://www.truefantix.com";
export const SITE_NAME = "TrueFanTix";
export const DEFAULT_SOCIAL_IMAGE = "/brand/truefantix-lockup.jpeg";

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

export function conciseDescription(value: string, maxLength = 158) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function schemaDate(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

export function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
