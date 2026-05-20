"use client";

import React, { useState, useEffect } from "react";
import Footer from "@/components/Footer";
import TicketCard from "@/components/tickets/TicketCard";
import { inferCoordsFromCity, mapApiTicketToCard, sortTicketsByPriority } from "@/lib/ticketsView";
import type { TicketCardView } from "@/lib/ticketsView";

type Ticket = TicketCardView;

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [priceRange, setPriceRange] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [priceTagFilter, setPriceTagFilter] = useState("all");
  const [soldOutOnly, setSoldOutOnly] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    async function fetchTickets() {
      try {
        setLoading(true);
        const res = await fetch("/api/tickets?status=AVAILABLE&take=500", { cache: "no-store" });
        const json = await res.json();
        
        if (!res.ok) {
          throw new Error(json?.error || `Failed to fetch tickets (${res.status})`);
        }

        const rawTickets = json.tickets || json;
        
        const normalized: Ticket[] = rawTickets.map((t: any) => mapApiTicketToCard(t) as Ticket);

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

  useEffect(() => {
    let cancelled = false;

    async function loadUserLocation() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json: any = await res.json().catch(() => ({}));
        const fromProfile = inferCoordsFromCity(json?.user?.city);
        if (!cancelled && fromProfile) {
          setUserCoords(fromProfile);
          return;
        }
      } catch {
        // ignore and fallback to browser geolocation
      }

      if (typeof window !== 'undefined' && navigator.geolocation && !cancelled) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!cancelled) setUserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          },
          () => {
            // keep null; sorting will fall back to sold-out/date
          },
          { enableHighAccuracy: false, timeout: 4000, maximumAge: 300000 }
        );
      }
    }

    loadUserLocation();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch dynamic images for tickets
  async function fetchImagesForTickets(ticketList: Ticket[]) {
    // Fetch one image per logical event key so identical events stay visually consistent.
    const keyFor = (t: Ticket) => `${t.title}|||${t.date}|||${t.venue}|||${t.eventType}`;
    const uniqueKeys = Array.from(new Set(ticketList.map(keyFor)));
    const imageByKey = new Map<string, string>();

    await Promise.all(
      uniqueKeys.map(async (key) => {
        const [title, _date, _venue, eventType] = key.split("|||");
        try {
          const res = await fetch(
            `/api/tickets/image?title=${encodeURIComponent(title)}&eventType=${encodeURIComponent(eventType)}`
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data.imageUrl && !data.isPlaceholder) {
            imageByKey.set(key, data.imageUrl);
          }
        } catch {
          // Keep fallback image for this key.
        }
      })
    );

    const updatedTickets = ticketList.map((ticket) => {
      const img = imageByKey.get(keyFor(ticket));
      return img ? { ...ticket, dynamicImage: img } : ticket;
    });

    setTickets(updatedTickets);
  }

  const filteredTickets = React.useMemo(() => {
    return tickets.filter((ticket: any) => {
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

      if (startDate || endDate) {
        const td = new Date(ticket.date);
        if (Number.isNaN(td.getTime())) return false;

        if (startDate) {
          const s = new Date(startDate);
          s.setHours(0, 0, 0, 0);
          if (td < s) return false;
        }

        if (endDate) {
          const e = new Date(endDate);
          e.setHours(23, 59, 59, 999);
          if (td > e) return false;
        }
      }

      return true;
    });
  }, [tickets, searchQuery, priceRange, eventType, priceTagFilter, soldOutOnly, startDate, endDate]);

  const sortedFilteredTickets = React.useMemo(
    () => sortTicketsByPriority(filteredTickets, userCoords),
    [filteredTickets, userCoords]
  );

  const clearFilters = () => {
    setSearchQuery("");
    setPriceRange("all");
    setEventType("all");
    setPriceTagFilter("all");
    setSoldOutOnly(false);
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-12">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4" style={{ color: "#e6edf5" }}>Browse Tickets</h1>
          <p className="text-xl" style={{ color: "#e6edf5" }}>
            Find tickets at or below face value for your favorite events
          </p>
        </div>
      </section>

      {/* Search and Filters */}
      <section className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span className="text-red-600 text-lg font-bold leading-none">✕</span>
              <span>Validation mismatch / invalid listing</span>
            </div>
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span className="text-blue-500 text-lg font-bold leading-none">✕</span>
              <span>Price unconfirmed (needs verification)</span>
            </div>
          </div>

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

          <div className="flex flex-wrap gap-6 mt-4 items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={soldOutOnly}
                onChange={(e) => setSoldOutOnly(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300"
              />
              <span className="text-gray-700 dark:text-gray-300">⭐ Sold Out Events Only</span>
            </label>

            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">End date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            
            {(searchQuery || eventType !== "all" || priceRange !== "all" || priceTagFilter !== "all" || soldOutOnly || startDate || endDate) && (
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
              {loading ? "Loading tickets..." : `${sortedFilteredTickets.length} ticket${sortedFilteredTickets.length !== 1 ? "s" : ""} found`}
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

          {!loading && !error && sortedFilteredTickets.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-600 text-lg">No tickets match your search.</p>
              <button onClick={clearFilters} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg">
                Clear Filters
              </button>
            </div>
          )}

          {!loading && !error && sortedFilteredTickets.length > 0 && (
            <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0 lg:grid-cols-3 xl:grid-cols-4">
              {sortedFilteredTickets.map((ticket) => (
                <div key={ticket.id} className="min-w-[18rem] max-w-[18rem] snap-start sm:min-w-0 sm:max-w-none">
                  <TicketCard ticket={ticket} />
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
