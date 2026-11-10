import { conciseDescription, schemaDate } from "@/lib/seo";

type EventSeoFacts = {
  description?: string | null;
  organizerName?: string | null;
  performerName?: string | null;
  endDate?: string | null;
  seoVerifiedAt?: Date | string | null;
};

type EventStructuredDataInput = EventSeoFacts & {
  name: string;
  startDate: string | null | undefined;
  venueName: string;
  url: string;
  image: string[];
  offers?: unknown;
  fallbackDescription: string;
  location?: Record<string, unknown>;
};

function clean(value: string | null | undefined) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

export function buildEventStructuredData(input: EventStructuredDataInput) {
  const verified = Boolean(input.seoVerifiedAt);
  const description = conciseDescription(clean(input.description) || input.fallbackDescription, 300);
  const organizerName = verified ? clean(input.organizerName) : undefined;
  const performerName = verified ? clean(input.performerName) : undefined;
  const endDate = verified ? schemaDate(input.endDate) : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: input.name,
    description,
    startDate: schemaDate(input.startDate),
    ...(endDate ? { endDate } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: input.url,
    image: input.image,
    location: input.location || { "@type": "Place", name: input.venueName },
    ...(organizerName ? { organizer: { "@type": "Organization", name: organizerName } } : {}),
    ...(performerName ? { performer: { "@type": "PerformingGroup", name: performerName } } : {}),
    ...(input.offers ? { offers: input.offers } : {}),
  };
}
