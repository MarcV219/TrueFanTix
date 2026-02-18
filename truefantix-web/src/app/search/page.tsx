"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

type Ticket = {
  id: string;
  title: string;
  venue: string;
  date: string;
  price: number;
  faceValue: number | null;
  image: string;
  seller: {
    id: string;
    name: string;
    rating: number;
    reviews: number;
    badges: string[];
  };
};

type SearchResponse = {
  ok: boolean;
  tickets?: Ticket[];
  nextCursor?: string | null;
  hasMore?: boolean;
  error?: string;
};

const DEFAULT_IMAGE = "/default.jpg";

function resolveTicketImageSrc(raw: unknown) {
  let s = String(raw ?? "").trim();
  if (!s) return DEFAULT_IMAGE;

  const winPublicIdx = s.toLowerCase().lastIndexOf("\\public\\");
  if (winPublicIdx !== -1) {
    s = s.slice(winPublicIdx + "\\public\\".length).replaceAll("\\", "/");
  }

  if (s.toLowerCase().startsWith("public/")) s = s.slice("public/".length);
  if (s.toLowerCase().startsWith("/public/")) s = s.slice("/public/".length);

  if (s === "/img" || s.startsWith("/img?")) return DEFAULT_IMAGE;

  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  if (!s.startsWith("/")) s = `/${s}`;

  return s;
}

function computePriceTag(price: number, faceValue: number | null): string {
  if (faceValue == null) return "Face Value";
  return price <= faceValue ? "Below Face Value" : "Face Value";
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState("relevance");

  const performSearch = useCallback(async (searchQuery: string, nextCursor?: string) => {
    if (!searchQuery.trim() && !nextCursor) {
      setTickets([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    params.set("sortBy", sortBy);
    if (nextCursor) params.set("cursor", nextCursor);
    params.set("limit", "20");

    try {
      const res = await fetch(`/api/tickets/search?${params.toString()}`);
      const data: SearchResponse = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to search tickets.");
        return;
      }

      if (nextCursor) {
        setTickets((prev) => [...prev, ...(data.tickets || [])]);
      } else {
        setTickets(data.tickets || []);
      }
      setCursor(data.nextCursor || null);
      setHasMore(data.hasMore || false);

      // Update URL
      const url = new URL(window.location.href);
      if (searchQuery.trim()) {
        url.searchParams.set("q", searchQuery.trim());
      } else {
        url.searchParams.delete("q");
      }
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      setError("Failed to search tickets. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [minPrice, maxPrice, sortBy]);

  // Initial search
  useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery);
    }
  }, []); // Only on mount

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
    performSearch(searchInput);
  };

  const handleLoadMore = () => {
    if (cursor) {
      performSearch(query, cursor);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 24 }}>Search Tickets</h1>

      {/* Search Form */}
      <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 300px" }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 14, fontWeight: 600 }}>
              Search
            </label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Artist, team, venue..."
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.9)",
                fontSize: 16,
              }}
            />
          </div>

          <div style={{ width: 140 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 14, fontWeight: 600 }}>
              Min Price
            </label>
            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="$"
              min="0"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.9)",
                fontSize: 16,
              }}
            />
          </div>

          <div style={{ width: 140 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 14, fontWeight: 600 }}>
              Max Price
            </label>
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="$"
              min="0"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.9)",
                fontSize: 16,
              }}
            />
          </div>

          <div style={{ width: 160 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 14, fontWeight: 600 }}>
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.9)",
                fontSize: 16,
                background: "white",
              }}
            >
              <option value="relevance">Relevance</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="newest">Newest First</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: "12px 24px",
              borderRadius: 10,
              border: "1px solid rgba(37, 99, 235, 0.35)",
              background: "rgba(37, 99, 235, 1)",
              color: "white",
              fontWeight: 800,
              fontSize: 16,
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,0,0,0.35)",
            background: "rgba(254, 242, 242, 1)",
            color: "rgba(153, 27, 27, 1)",
            marginBottom: 24,
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {tickets.length === 0 && !isLoading && query && (
        <div style={{ textAlign: "center", padding: "40px 0", opacity: 0.7 }}>
          <p style={{ fontSize: 18 }}>No tickets found for &quot;{query}&quot;</p>
          <p style={{ marginTop: 8 }}>Try a different search term or adjust filters.</p>
        </div>
      )}

      {tickets.length === 0 && !isLoading && !query && (
        <div style={{ textAlign: "center", padding: "40px 0", opacity: 0.7 }}>
          <p style={{ fontSize: 18 }}>Search for tickets</p>
          <p style={{ marginTop: 8 }}>Enter an artist, team, or venue name above.</p>
        </div>
      )}

      {tickets.length > 0 && (
        <>
          <div style={{ marginBottom: 16, opacity: 0.7 }}>
            Found {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
            {query ? ` for "${query}"` : ""}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
            {tickets.map((ticket) => (
              <Link
                key={ticket.id}
                href={`/ticket/${ticket.id}`}
                style={{
                  display: "block",
                  textDecoration: "none",
                  color: "inherit",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.1)",
                  overflow: "hidden",
                  background: "white",
                  transition: "transform 0.2s, box-shadow 0.2s",
                }}
              >
                <div style={{ position: "relative", height: 160 }}>
                  <img
                    src={resolveTicketImageSrc(ticket.image)}
                    alt={ticket.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    loading="lazy"
                  />
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      padding: "4px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: computePriceTag(ticket.price, ticket.faceValue) === "Below Face Value"
                        ? "rgba(34, 197, 94, 0.9)"
                        : "rgba(6, 74, 147, 0.9)",
                      color: "white",
                    }}
                  >
                    {computePriceTag(ticket.price, ticket.faceValue)}
                  </span>
                </div>

                <div style={{ padding: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>
                    {ticket.title}
                  </h3>
                  <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 8 }}>
                    {ticket.venue}
                  </p>
                  <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 12 }}>
                    {ticket.date}
                  </p>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "rgba(6, 74, 147, 1)" }}>
                      ${ticket.price.toFixed(2)}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                      <span style={{ color: "#fbbf24" }}>★</span>
                      <span>{ticket.seller.rating.toFixed(1)}</span>
                      <span style={{ opacity: 0.5 }}>({ticket.seller.reviews})</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 32 }}>
              <button
                onClick={handleLoadMore}
                disabled={isLoading}
                style={{
                  padding: "12px 32px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.18)",
                  background: "rgba(248, 250, 252, 1)",
                  fontWeight: 800,
                  fontSize: 16,
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                {isLoading ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 16px", textAlign: "center" }}>
          <div style={{ opacity: 0.7 }}>Loading search...</div>
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
