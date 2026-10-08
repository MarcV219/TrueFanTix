type SearxngResult = {
  title?: string;
  url?: string;
  content?: string;
  img_src?: string;
  thumbnail?: string;
  engine?: string;
};

export type WebSearchResult = {
  title: string;
  url: string;
  description: string;
  source: string;
};

export type ImageSearchResult = WebSearchResult & {
  imageUrl: string;
};

function baseUrl() {
  return (process.env.SEARXNG_BASE_URL || "http://127.0.0.1:8888").replace(/\/+$/, "");
}

async function search(query: string, categories: "general" | "images", count: number): Promise<SearxngResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories,
    language: "en",
    safesearch: "1",
  });

  try {
    const response = await fetch(`${baseUrl()}/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data?.results) ? data.results : []).slice(0, Math.max(1, count));
  } catch {
    return [];
  }
}

export async function searchWeb(query: string, count = 10): Promise<WebSearchResult[]> {
  const rows = await search(query, "general", count);
  return rows
    .map((row) => ({
      title: String(row.title || ""),
      url: String(row.url || ""),
      description: String(row.content || ""),
      source: String(row.engine || "searxng"),
    }))
    .filter((row) => row.url.startsWith("http"));
}

export async function searchImages(query: string, count = 20): Promise<ImageSearchResult[]> {
  const rows = await search(query, "images", Math.max(count * 2, count));
  return rows
    .map((row) => ({
      title: String(row.title || ""),
      url: String(row.url || ""),
      description: String(row.content || ""),
      source: String(row.engine || "searxng"),
      imageUrl: String(row.img_src || row.thumbnail || ""),
    }))
    .filter((row) => row.imageUrl.startsWith("http"))
    .slice(0, count);
}

export function paidBraveFallbackEnabled() {
  return process.env.BRAVE_SEARCH_FALLBACK_ENABLED === "true";
}
