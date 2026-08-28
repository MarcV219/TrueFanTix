export const ATTRIBUTION_STORAGE_KEY = "tft_campaign_attribution";

export type CampaignAttribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  firstPath: string | null;
  referrerHost: string | null;
};

const LIMITS = {
  source: 80,
  medium: 80,
  campaign: 120,
  content: 120,
  term: 120,
  firstPath: 200,
  referrerHost: 120,
} as const;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return text ? text.slice(0, max) : null;
}

export function sanitizeReferrerHost(value: unknown): string | null {
  const text = clean(value, 500);
  if (!text) return null;
  try {
    const candidate = /^[a-z0-9.-]+$/i.test(text) ? `https://${text}` : text;
    const host = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "truefantix.com" || host === "truefantix.ca") return null;
    return host.slice(0, LIMITS.referrerHost);
  } catch {
    return null;
  }
}

export function sanitizeAttribution(value: unknown): CampaignAttribution {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const firstPath = clean(input.firstPath, LIMITS.firstPath);
  return {
    source: clean(input.source, LIMITS.source),
    medium: clean(input.medium, LIMITS.medium),
    campaign: clean(input.campaign, LIMITS.campaign),
    content: clean(input.content, LIMITS.content),
    term: clean(input.term, LIMITS.term),
    firstPath: firstPath?.startsWith("/") && !firstPath.startsWith("//") ? firstPath : null,
    referrerHost: sanitizeReferrerHost(input.referrerHost),
  };
}

export function attributionSource(value: CampaignAttribution): string {
  return value.source || value.referrerHost || "direct";
}
