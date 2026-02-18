"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import Footer from "@/components/Footer";

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
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (!s.startsWith("/")) s = `/${s}`;

  return s;
}

function computePriceTag(price: number, faceValue: number | null, isSoldOut: boolean = false): string {
  if (isSoldOut) return "Face Value";
  if (faceValue == null) return "Face Value";
  return price < faceValue ? "Below Face Value" : "Face Value";
}

function parseVenue(venue: string): { city: string; province: string; country: string } {
  const parts = venue.split(",").map(p => p.trim());
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const cityPart = parts[parts.length - 2];
    if (lastPart === "Toronto") {
      return { city: "Toronto", province: "ON", country: "Canada" };
    }
    return { city: cityPart || "Toronto", province: "ON", country: "Canada" };
  }
  return { city: "Toronto", province: "ON", country: "Canada" };
}

function getEventType(title: string): { type: string; label: string; placeholder: string } {
  const lower = title.toLowerCase();
  
  // Sports - specific team names first
  if (lower.match(/raptors|basketball/)) {
    return { type: "sports-basketball", label: "Sports: Basketball", placeholder: "/basketball-placeholder.jpg" };
  }
  if (lower.match(/leafs|hockey/)) {
    return { type: "sports-hockey", label: "Sports: Hockey", placeholder: "/hockey-placeholder.jpg" };
  }
  if (lower.match(/blue jays|baseball/)) {
    return { type: "sports-baseball", label: "Sports: Baseball", placeholder: "/sports-placeholder.jpg" };
  }
  if (lower.includes("football") && !lower.includes("hockey")) {
    return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  }
  if (lower.includes("soccer")) {
    return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  }
  if (lower.includes("lacrosse")) {
    return { type: "sports-lacrosse", label: "Sports: Lacrosse", placeholder: "/sports-placeholder.jpg" };
  }
  if (lower.match(/argos|argonauts/)) {
    return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  }
  if (lower.match(/tfc|toronto fc/)) {
    return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  }
  if (lower.match(/sports|vs\.|game/)) {
    return { type: "sports-other", label: "Sports: Other", placeholder: "/sports-placeholder.jpg" };
  }
  
  // Other event types
  if (lower.match(/taylor swift|drake|ed sheeran|weeknd|concert|tour|live music/)) {
    return { type: "concert", label: "Concert", placeholder: "/concert-placeholder.jpg" };
  }
  if (lower.match(/hamilton|theatre|theater|broadway|play/)) {
    return { type: "theatre", label: "Theatre", placeholder: "/theatre-placeholder.jpg" };
  }
  if (lower.match(/comedy|stand.up|comedian|funny/)) {
    return { type: "comedy", label: "Comedy", placeholder: "/comedy-placeholder.jpg" };
  }
  if (lower.match(/conference|summit|convention/)) {
    return { type: "conference", label: "Conference", placeholder: "/conference-placeholder.jpg" };
  }
  if (lower.match(/festival|music fest|coachella/)) {
    return { type: "festival", label: "Festival", placeholder: "/festival-placeholder.jpg" };
  }
  if (lower.match(/gala|ball|charity dinner/)) {
    return { type: "gala", label: "Gala", placeholder: "/gala-placeholder.jpg" };
  }
  if (lower.match(/opera|symphony|orchestra/)) {
    return { type: "opera", label: "Opera", placeholder: "/opera-placeholder.jpg" };
  }
  if (lower.match(/workshop|seminar|class|training/)) {
    return { type: "workshop", label: "Workshop", placeholder: "/workshop-placeholder.jpg" };
  }
  
  return { type: "other", label: "Other", placeholder: "/default.jpg" };
}

function getPlaceholderImage(title: string): string {
  const eventType = getEventType(title);
  return eventType.placeholder;
}

type Ticket = {
  id: string;
  title: string;
  date: string;
  venue: string;
  city: string;
  province: string;
  country: string;
  eventType: string;
  eventTypeLabel: string;
  price: number;
  faceValue: number | null;
  image: string;
  placeholderImage: string;
  sellerId: string;
  row: string | null;
  seat: string | null;
  badges: string[];
  rating: number;
  reviews: number;
  priceTag: string;
  isSoldOut: boolean;
  dynamicImage?: string;
  isImageLoading?: boolean;
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [priceRange, setPriceRange] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [priceTagFilter, setPriceTagFilter] = useState("all");
  const [soldOutOnly, setSoldOutOnly] = useState(false);

  useEffect(() => {
    async function fetchTickets() {
      try {
        setLoading(true);
        const res = await fetch("/api/tickets?status=AVAILABLE&take=100", { cache: "no-store" });
        const json = await res.json();
        
        if (!res.ok) {
          throw new Error(json?.error || `Failed to fetch tickets (${res.status})`);
        }

        const rawTickets = json.tickets || json;
        
        const normalized: Ticket[] = rawTickets.map((t: any) => {
          const venueInfo = parseVenue(t.venue || "");
          const eventTypeInfo = getEventType(t.title || "");
          const resolvedImage = resolveTicketImageSrc(t.image);
          const isSoldOut = t.event?.selloutStatus === "SOLD_OUT" || false;
          
          return {
            id: t.id,
            title: t.title,
            date: t.date,
            venue: t.venue,
            city: venueInfo.city,
            province: venueInfo.province,
            country: venueInfo.country,
            eventType: eventTypeInfo.type,
            eventTypeLabel: eventTypeInfo.label,
            price: Number(t.price ?? 0),
            faceValue: t.faceValue ?? null,
            image: resolvedImage,
            placeholderImage: eventTypeInfo.placeholder,
            sellerId: t.sellerId,
            row: t.row || null,
            seat: t.seat || null,
            badges: t.seller?.badges ?? [],
            rating: t.seller?.rating ?? 0,
            reviews: t.seller?.reviews ?? 0,
            priceTag: computePriceTag(Number(t.price ?? 0), t.faceValue ?? null, isSoldOut),
            isSoldOut,
          };
        });

        setTickets(normalized);
        
        // Fetch dynamic images for tickets
        fetchImagesForTickets(normalized);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load tickets");
      } finally {
        setLoading(false);
      }
    }

    fetchTickets();
  }, []);

  // Fetch dynamic images for tickets
  async function fetchImagesForTickets(ticketList: Ticket[]) {
    const updatedTickets = [...ticketList];
    
    for (let i = 0; i < updatedTickets.length; i++) {
      const ticket = updatedTickets[i];
      
      try {
        const res = await fetch(
          `/api/tickets/image?title=${encodeURIComponent(ticket.title)}&eventType=${encodeURIComponent(ticket.eventType)}`
        );
        
        if (res.ok) {
          const data = await res.json();
          if (data.imageUrl && !data.isPlaceholder) {
            updatedTickets[i] = { ...ticket, dynamicImage: data.imageUrl };
          }
        }
      } catch (e) {
        // Silently fail and use placeholder
      }
    }
    
    setTickets(updatedTickets);
  }

  const filteredTickets = React.useMemo(() => {
    return tickets.filter((ticket) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchable = `${ticket.title} ${ticket.venue} ${ticket.city} ${ticket.eventTypeLabel}`.toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      if (priceRange !== "all") {
        const price = ticket.price;
        switch (priceRange) {
          case "under50": if (price >= 50) return false; break;
          case "50to100": if (price < 50 || price >= 100) return false; break;
          case "100to200": if (price < 100 || price >= 200) return false; break;
          case "over200": if (price < 200) return false; break;
        }
      }

      if (eventType !== "all" && ticket.eventType !== eventType) {
        return false;
      }

      if (priceTagFilter !== "all" && ticket.priceTag !== priceTagFilter) {
        return false;
      }

      if (soldOutOnly && !ticket.isSoldOut) {
        return false;
      }

      return true;
    });
  }, [tickets, searchQuery, priceRange, eventType, priceTagFilter, soldOutOnly]);

  const clearFilters = () => {
    setSearchQuery("");
    setPriceRange("all");
    setEventType("all");
    setPriceTagFilter("all");
    setSoldOutOnly(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-12">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Browse Tickets</h1>
          <p className="text-xl text-gray-300">
            Find tickets at or below face value for your favorite events
          </p>
        </div>
      </section>

      {/* Search and Filters */}
      <section className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <input
              type="text"
              placeholder="Search events, venues, artists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />

            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Event Types</option>
              <option value="concert">Concert</option>
              <option value="sports-basketball">Sports: Basketball</option>
              <option value="sports-football">Sports: Football</option>
              <option value="sports-hockey">Sports: Hockey</option>
              <option value="sports-soccer">Sports: Soccer</option>
              <option value="sports-lacrosse">Sports: Lacrosse</option>
              <option value="sports-baseball">Sports: Baseball</option>
              <option value="sports-other">Sports: Other</option>
              <option value="theatre">Theatre</option>
              <option value="comedy">Comedy</option>
              <option value="conference">Conference</option>
              <option value="festival">Festival</option>
              <option value="gala">Gala</option>
              <option value="opera">Opera</option>
              <option value="workshop">Workshop</option>
              <option value="other">Other</option>
            </select>

            <select
              value={priceRange}
              onChange={(e) => setPriceRange(e.target.value)}
              className="px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">Any Price</option>
              <option value="under50">Under $50</option>
              <option value="50to100">$50 - $100</option>
              <option value="100to200">$100 - $200</option>
              <option value="over200">$200+</option>
            </select>

            <select
              value={priceTagFilter}
              onChange={(e) => setPriceTagFilter(e.target.value)}
              className="px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">Any Price Type</option>
              <option value="Face Value">Face Value</option>
              <option value="Below Face Value">Below Face Value</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-6 mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={soldOutOnly}
                onChange={(e) => setSoldOutOnly(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300"
              />
              <span className="text-gray-700 dark:text-gray-300">⭐ Sold Out Events Only</span>
            </label>
            
            {(searchQuery || eventType !== "all" || priceRange !== "all" || priceTagFilter !== "all" || soldOutOnly) && (
              <button
                onClick={clearFilters}
                className="text-blue-600 hover:underline"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Tickets Grid */}
      <section className="py-8 px-4 flex-1">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <p className="text-gray-600 dark:text-gray-400">
              {loading ? "Loading tickets..." : `${filteredTickets.length} ticket${filteredTickets.length !== 1 ? "s" : ""} found`}
            </p>
          </div>

          {loading && (
            <div className="text-center py-12">
              <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading tickets...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-red-600 font-semibold">{error}</p>
              <button onClick={() => window.location.reload()} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg">
                Retry
              </button>
            </div>
          )}

          {!loading && !error && filteredTickets.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-600 text-lg">No tickets match your search.</p>
              <button onClick={clearFilters} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg">
                Clear Filters
              </button>
            </div>
          )}

          {!loading && !error && filteredTickets.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition flex flex-col border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <div className="relative">
                    <img
                      src={ticket.dynamicImage || ticket.placeholderImage || DEFAULT_IMAGE}
                      alt={ticket.title}
                      className="w-full h-48 object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).src = ticket.placeholderImage || DEFAULT_IMAGE; }}
                    />
                    {/* Badges */}
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      {ticket.isSoldOut && (
                        <span className="bg-amber-500 text-white px-2 py-1 text-xs font-semibold rounded">
                          ⭐ Sold Out
                        </span>
                      )}
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        ticket.priceTag === "Face Value" 
                          ? "bg-green-100 text-green-800" 
                          : "bg-blue-100 text-blue-800"
                      }`}>
                        {ticket.priceTag}
                      </span>
                    </div>
                    <span className="absolute top-2 right-2 px-2 py-1 text-xs font-semibold rounded bg-gray-800 text-white">
                      {ticket.eventTypeLabel}
                    </span>
                  </div>

                  <div className="p-4 flex flex-col flex-1">
                    <h4 className="font-bold text-lg text-gray-900 dark:text-white mb-1">{ticket.title}</h4>
                    <p className="text-gray-600 dark:text-gray-400 text-sm">{ticket.date}</p>
                    <p className="text-gray-500 dark:text-gray-500 text-sm mb-1">{ticket.venue}</p>
                    <p className="text-gray-500 dark:text-gray-500 text-xs mb-1">
                      {ticket.city}, {ticket.province}, {ticket.country}
                    </p>
                    
                    {(ticket.row || ticket.seat) && (
                      <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">
                        {ticket.row && `Row ${ticket.row}`}
                        {ticket.row && ticket.seat && " • "}
                        {ticket.seat && `Seat ${ticket.seat}`}
                      </p>
                    )}

                    <div className="flex items-center mb-2">
                      <div className="flex text-yellow-400 text-sm">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <span key={i}>{i < Math.round(ticket.rating) ? "★" : "☆"}</span>
                        ))}
                      </div>
                      <span className="text-sm text-gray-500 ml-2">({ticket.reviews})</span>
                    </div>

                    <p className="font-bold text-lg text-gray-900 dark:text-white mb-3">${ticket.price.toFixed(2)}</p>

                    <div className="mt-auto flex gap-2">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="flex-1 text-center bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
                      >
                        View Ticket
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
