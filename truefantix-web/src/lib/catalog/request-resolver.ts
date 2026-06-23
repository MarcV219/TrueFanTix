import { searchProviderCatalog, type ProviderCatalogSuggestion } from "@/lib/catalog/provider-catalog";
import type { CatalogSuggestionType } from "@/lib/catalog/live-event-catalog";

export type CatalogRequestResolution =
  | { status: "FOUND"; suggestion: ProviderCatalogSuggestion }
  | { status: "NEEDS_CLARIFICATION"; suggestions: ProviderCatalogSuggestion[]; question: string }
  | { status: "NOT_FOUND" };

function wordsForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizedDisplayName(value: string) {
  return wordsForSearch(value).join(" ");
}

function candidateNames(item: ProviderCatalogSuggestion) {
  return [item.canonicalName, item.label, item.value, ...(item.aliases ?? [])]
    .map((value) => normalizedDisplayName(value ?? ""))
    .filter(Boolean);
}

function uniqueByCanonicalName(items: ProviderCatalogSuggestion[]) {
  const seen = new Set<string>();
  const out: ProviderCatalogSuggestion[] = [];

  for (const item of items) {
    const locationKey =
      item.type === "VENUE" || item.type === "CITY"
        ? [item.address, item.city, item.region, item.country].map((part) => normalizedDisplayName(part ?? "")).join(":")
        : "";
    const key = `${item.type}:${normalizedDisplayName(item.canonicalName || item.label || item.value)}:${locationKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function clarificationQuestion(type: CatalogSuggestionType, value: string, suggestions: ProviderCatalogSuggestion[]) {
  const choices = suggestions
    .slice(0, 5)
    .map((suggestion) => {
      const detail = suggestion.subtitle || [suggestion.city, suggestion.region, suggestion.country].filter(Boolean).join(", ");
      return detail ? `${suggestion.label} (${detail})` : suggestion.label;
    })
    .join("; ");

  return `We found more than one possible ${type.toLowerCase()} for "${value}". Which one did you mean? ${choices}`;
}

export async function resolveCatalogRequest({
  type,
  value,
  limit = 8,
}: {
  type: CatalogSuggestionType;
  value: string;
  limit?: number;
}): Promise<CatalogRequestResolution> {
  const q = value.trim();
  if (q.length < 2) return { status: "NOT_FOUND" };

  const suggestions = uniqueByCanonicalName(await searchProviderCatalog({ query: q, type, limit, includeProviders: true }));
  if (suggestions.length === 0) return { status: "NOT_FOUND" };

  const normalizedQuery = normalizedDisplayName(q);
  const exactMatches = suggestions.filter((suggestion) => candidateNames(suggestion).some((name) => name === normalizedQuery));
  if (exactMatches.length === 1) {
    return { status: "FOUND", suggestion: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    return {
      status: "NEEDS_CLARIFICATION",
      suggestions: exactMatches.slice(0, 5),
      question: clarificationQuestion(type, q, exactMatches),
    };
  }

  const prefixMatches = suggestions.filter((suggestion) =>
    candidateNames(suggestion).some((name) => name.startsWith(`${normalizedQuery} `) || normalizedQuery.startsWith(`${name} `))
  );
  if (prefixMatches.length === 1 && suggestions.length === 1) {
    return { status: "FOUND", suggestion: prefixMatches[0] };
  }

  return {
    status: "NEEDS_CLARIFICATION",
    suggestions: suggestions.slice(0, 5),
    question: clarificationQuestion(type, q, suggestions),
  };
}
