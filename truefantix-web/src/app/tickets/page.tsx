"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import TicketCard from "@/components/tickets/TicketCard";
import { fetchJson } from "@/lib/api-fetch";
import {
  formatMoney,
  inferCoordsFromCity,
  isTicketWithinRadius,
  mapApiTicketToCard,
  sortTicketsByPriority,
} from "@/lib/ticketsView";
import type { TicketCardView } from "@/lib/ticketsView";

type Ticket = TicketCardView;
type RadiusUnit = "km" | "mi";
type BrowseFilters = {
  searchQuery: string;
  radiusValue: string;
  radiusUnit: RadiusUnit;
  eventType: string;
  priceRange: string;
  priceTagFilter: string;
  soldOutOnly: boolean;
  startDate: string;
  endDate: string;
};
type CatalogSuggestion = {
  type: "ARTIST" | "TEAM" | "VENUE" | "CITY" | "SPORT" | "SHOW" | "OTHER";
  value: string;
  label: string;
  canonicalName?: string;
  subtitle?: string;
  city?: string;
  region?: string;
  country?: string;
  metadata?: string | null;
};

const DEFAULT_RADIUS_VALUE = "50";
const DEFAULT_RADIUS_UNIT: RadiusUnit = "km";
const RADIUS_PREF_PREFIX = "truefantix:tickets:radius";
const ANONYMOUS_RADIUS_PREF_KEY = `${RADIUS_PREF_PREFIX}:anonymous`;
const RETURN_FILTERS_KEY = "truefantix:tickets:returnFilters";
const RETURN_PENDING_KEY = "truefantix:tickets:returnPending";
const FILTER_QUERY_KEYS = ["q", "radius", "unit", "type", "price", "priceTag", "soldOut", "start", "end"];

function radiusPreferenceKey(userId: unknown) {
  const id = String(userId || "").trim();
  return id ? `${RADIUS_PREF_PREFIX}:${id}` : ANONYMOUS_RADIUS_PREF_KEY;
}

function readRadiusPreference(key: string): { value: string; unit: RadiusUnit } | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { value?: unknown; unit?: unknown };
    const value = String(parsed.value || "").trim();
    const unit = parsed.unit === "mi" ? "mi" : parsed.unit === "km" ? "km" : null;
    const numeric = Number(value);

    if (!value || !Number.isFinite(numeric) || numeric <= 0 || !unit) return null;
    return { value, unit };
  } catch {
    return null;
  }
}

function writeRadiusPreference(key: string, value: string, unit: RadiusUnit) {
  if (typeof window === "undefined") return;

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;

  try {
    window.localStorage.setItem(key, JSON.stringify({ value, unit }));
  } catch {
    // Ignore storage failures; the filters still work for this page view.
  }
}

function getInitialQueryParam(key: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) || "";
}

function normalizeRadiusUnit(value: unknown): RadiusUnit {
  return value === "mi" ? "mi" : "km";
}

function defaultBrowseFilters(): BrowseFilters {
  return {
    searchQuery: "",
    radiusValue: readRadiusPreference(ANONYMOUS_RADIUS_PREF_KEY)?.value ?? DEFAULT_RADIUS_VALUE,
    radiusUnit: readRadiusPreference(ANONYMOUS_RADIUS_PREF_KEY)?.unit ?? DEFAULT_RADIUS_UNIT,
    eventType: "all",
    priceRange: "all",
    priceTagFilter: "all",
    soldOutOnly: false,
    startDate: "",
    endDate: "",
  };
}

function hasFilterQueryParams() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return FILTER_QUERY_KEYS.some((key) => params.has(key));
}

function isTicketDetailReferrer() {
  if (typeof document === "undefined" || !document.referrer) return false;

  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin && /^\/tickets\/[^/]+\/?$/.test(referrer.pathname);
  } catch {
    return false;
  }
}

function readReturnFilters(): BrowseFilters | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(RETURN_FILTERS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<BrowseFilters>;
    const radiusValue = String(parsed.radiusValue || "").trim();
    const numericRadius = Number(radiusValue);
    if (!radiusValue || !Number.isFinite(numericRadius) || numericRadius <= 0) return null;

    return {
      searchQuery: String(parsed.searchQuery || ""),
      radiusValue,
      radiusUnit: normalizeRadiusUnit(parsed.radiusUnit),
      eventType: String(parsed.eventType || "all"),
      priceRange: String(parsed.priceRange || "all"),
      priceTagFilter: String(parsed.priceTagFilter || "all"),
      soldOutOnly: parsed.soldOutOnly === true,
      startDate: String(parsed.startDate || ""),
      endDate: String(parsed.endDate || ""),
    };
  } catch {
    return null;
  }
}

function shouldRestoreReturnFilters() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(RETURN_PENDING_KEY) === "1" || isTicketDetailReferrer();
}

function getFiltersFromUrl(): BrowseFilters {
  const defaults = defaultBrowseFilters();
  const fromUrl = getInitialQueryParam("radius");
  const numeric = Number(fromUrl);

  return {
    searchQuery: getInitialQueryParam("q"),
    radiusValue: fromUrl && Number.isFinite(numeric) && numeric > 0 ? fromUrl : defaults.radiusValue,
    radiusUnit: normalizeRadiusUnit(getInitialQueryParam("unit") || defaults.radiusUnit),
    eventType: getInitialQueryParam("type") || "all",
    priceRange: getInitialQueryParam("price") || "all",
    priceTagFilter: getInitialQueryParam("priceTag") || "all",
    soldOutOnly: getInitialQueryParam("soldOut") === "1",
    startDate: getInitialQueryParam("start"),
    endDate: getInitialQueryParam("end"),
  };
}

function getInitialBrowseFilters(): BrowseFilters {
  if (hasFilterQueryParams()) return getFiltersFromUrl();

  if (shouldRestoreReturnFilters()) {
    const filters = readReturnFilters();
    if (filters) return filters;
  }

  return defaultBrowseFilters();
}

function writeReturnFilters(filters: BrowseFilters) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(RETURN_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage failures; browser Back can still restore normal page state.
  }
}

function markTicketReturnPending() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(RETURN_PENDING_KEY, "1");
  } catch {
    // Ignore storage failures.
  }
}

function clearTicketReturnPending() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(RETURN_PENDING_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function parseSuggestionCoords(suggestion: CatalogSuggestion): { lat: number; lon: number } | null {
  const fallback = inferCoordsFromCity(suggestion.city || suggestion.value || suggestion.label);
  if (fallback) return fallback;

  try {
    const metadata = suggestion.metadata ? JSON.parse(suggestion.metadata) : null;
    const lat = Number(metadata?.lat);
    const lon = Number(metadata?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  } catch {
    return null;
  }

  return null;
}

function findBestCitySuggestion(query: string, suggestions: CatalogSuggestion[]) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;

  const cities = suggestions.filter((suggestion) => suggestion.type === "CITY");
  const exactMatches = cities.filter((suggestion) =>
    [suggestion.label, suggestion.value, suggestion.canonicalName, suggestion.city]
      .map((value) => normalizeSearchText(value || ""))
      .some((value) => value === normalizedQuery)
  );
  return exactMatches.find((suggestion) => parseSuggestionCoords(suggestion)) ?? exactMatches[0] ?? null;
}

function mergeCatalogSuggestions(...groups: CatalogSuggestion[][]) {
  const seen = new Set<string>();
  const merged: CatalogSuggestion[] = [];

  for (const suggestion of groups.flat()) {
    const key = [
      suggestion.type,
      normalizeSearchText(suggestion.label),
      normalizeSearchText(suggestion.subtitle || ""),
      suggestion.region || "",
      suggestion.country || "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
  }

  return merged;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function writeFilterQuery(params: BrowseFilters) {
  if (typeof window === "undefined") return;

  const next = new URLSearchParams(window.location.search);
  FILTER_QUERY_KEYS.forEach((key) => next.delete(key));

  if (params.searchQuery.trim()) next.set("q", params.searchQuery.trim());
  if (params.radiusValue !== DEFAULT_RADIUS_VALUE) next.set("radius", params.radiusValue);
  if (params.radiusUnit !== DEFAULT_RADIUS_UNIT) next.set("unit", params.radiusUnit);
  if (params.eventType !== "all") next.set("type", params.eventType);
  if (params.priceRange !== "all") next.set("price", params.priceRange);
  if (params.priceTagFilter !== "all") next.set("priceTag", params.priceTagFilter);
  if (params.soldOutOnly) next.set("soldOut", "1");
  if (params.startDate) next.set("start", params.startDate);
  if (params.endDate) next.set("end", params.endDate);

  const query = next.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

export default function TicketsPage() {
  const router = useRouter();
  const [initialFilters] = useState(() => getInitialBrowseFilters());
  const [shouldPreserveInitialRadius] = useState(() => hasFilterQueryParams() || shouldRestoreReturnFilters());
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
  const [priceRange, setPriceRange] = useState(initialFilters.priceRange);
  const [eventType, setEventType] = useState(initialFilters.eventType);
  const [priceTagFilter, setPriceTagFilter] = useState(initialFilters.priceTagFilter);
  const [soldOutOnly, setSoldOutOnly] = useState(initialFilters.soldOutOnly);
  const [startDate, setStartDate] = useState(initialFilters.startDate);
  const [endDate, setEndDate] = useState(initialFilters.endDate);
  const [radiusPreferenceStorageKey, setRadiusPreferenceStorageKey] = useState(ANONYMOUS_RADIUS_PREF_KEY);
  const [radiusValue, setRadiusValue] = useState(initialFilters.radiusValue);
  const [radiusUnit, setRadiusUnit] = useState<RadiusUnit>(initialFilters.radiusUnit);
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [searchSuggestions, setSearchSuggestions] = useState<CatalogSuggestion[]>([]);
  const [searchSuggestionCoords, setSearchSuggestionCoords] = useState<{ lat: number; lon: number } | null>(null);

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

        if (!cancelled) {
          const nextPreferenceKey = radiusPreferenceKey(json?.user?.id);
          setRadiusPreferenceStorageKey(nextPreferenceKey);

          const savedRadiusPreference = readRadiusPreference(nextPreferenceKey);
          if (savedRadiusPreference && !shouldPreserveInitialRadius) {
            setRadiusValue(savedRadiusPreference.value);
            setRadiusUnit(savedRadiusPreference.unit);
          }
        }

        const profileCity = String(json?.user?.city || "").trim();
        const fromProfile = inferCoordsFromCity(profileCity);
        if (!cancelled && fromProfile) {
          setHomeCoords(fromProfile);
        } else if (!cancelled && profileCity.length >= 2) {
          const params = new URLSearchParams({ q: profileCity, type: "CITY", limit: "5" });
          const cityRes = await fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" });
          const cityJson = await cityRes.json().catch(() => ({}));
          const suggestions = Array.isArray(cityJson?.suggestions) ? cityJson.suggestions as CatalogSuggestion[] : [];
          const citySuggestion = findBestCitySuggestion(profileCity, suggestions) ?? suggestions.find((suggestion) => suggestion.type === "CITY");
          const coords = citySuggestion ? parseSuggestionCoords(citySuggestion) : null;
          if (!cancelled && coords) setHomeCoords(coords);
        }
      } catch {
        // Keep null; distance filtering needs the saved home city or a searched city.
      }
    }

    loadUserLocation();
    return () => {
      cancelled = true;
    };
  }, [shouldPreserveInitialRadius]);

  useEffect(() => {
    writeRadiusPreference(radiusPreferenceStorageKey, radiusValue, radiusUnit);
  }, [radiusPreferenceStorageKey, radiusUnit, radiusValue]);

  useEffect(() => {
    writeFilterQuery({
      searchQuery,
      radiusValue,
      radiusUnit,
      eventType,
      priceRange,
      priceTagFilter,
      soldOutOnly,
      startDate,
      endDate,
    });
    writeReturnFilters({
      searchQuery,
      radiusValue,
      radiusUnit,
      eventType,
      priceRange,
      priceTagFilter,
      soldOutOnly,
      startDate,
      endDate,
    });
  }, [endDate, eventType, priceRange, priceTagFilter, radiusUnit, radiusValue, searchQuery, soldOutOnly, startDate]);

  useEffect(() => {
    clearTicketReturnPending();
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    setSearchSuggestionCoords(null);

    if (query.length < 2) {
      setSearchSuggestions([]);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const suggestionGroups = [
          new URLSearchParams({ q: query, type: "ARTIST", limit: "8" }),
          new URLSearchParams({ q: query, type: "CITY", limit: "8" }),
          new URLSearchParams({ q: query, type: "VENUE", limit: "8" }),
          new URLSearchParams({ q: query, type: "SHOW", limit: "6" }),
          new URLSearchParams({ q: query, type: "ALL", limit: "10" }),
        ];
        const results = await Promise.allSettled(
          suggestionGroups.map((params) =>
            fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" }).then((res) => res.json())
          )
        );
        const suggestionLists = results.map((result) => {
          const data = result.status === "fulfilled" ? result.value : {};
          return Array.isArray(data?.suggestions) ? data.suggestions as CatalogSuggestion[] : [];
        });
        const suggestions = mergeCatalogSuggestions(...suggestionLists).slice(0, 18);
        if (!alive) return;

        setSearchSuggestions(suggestions);
        const citySuggestion = findBestCitySuggestion(query, suggestions);
        setSearchSuggestionCoords(citySuggestion ? parseSuggestionCoords(citySuggestion) : null);
      } catch {
        if (alive) {
          setSearchSuggestions([]);
          setSearchSuggestionCoords(null);
        }
      }
    }, 180);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  // Fetch dynamic images for tickets
  async function fetchImagesForTickets(ticketList: Ticket[]) {
    // Fetch one image per logical event key so identical events stay visually consistent.
    const keyFor = (t: Ticket) => `${t.title}|||${t.date}|||${t.venue}|||${t.eventType}`;
    const uniqueKeys = Array.from(new Set(ticketList.map(keyFor)));
    const imageByKey = new Map<string, string>();

    await Promise.all(
      uniqueKeys.map(async (key) => {
        const [title, , , eventType] = key.split("|||");
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

  const searchCenter = React.useMemo(() => searchSuggestionCoords ?? inferCoordsFromCity(searchQuery), [searchQuery, searchSuggestionCoords]);
  const distanceCenter = searchCenter ?? homeCoords;
  const radiusKm = React.useMemo(() => {
    const value = Number(radiusValue);
    if (!Number.isFinite(value) || value <= 0) return null;
    return radiusUnit === "mi" ? value * 1.609344 : value;
  }, [radiusUnit, radiusValue]);

  const filteredTickets = React.useMemo(() => {
    const hasRadiusFilter = Boolean(distanceCenter && radiusKm);

    return tickets.filter((ticket: any) => {
      const query = searchQuery.toLowerCase().trim();
      const searchable = `${ticket.title} ${ticket.venue} ${ticket.city} ${ticket.eventTypeLabel}`.toLowerCase();
      const textMatchesSearch = !query || searchable.includes(query);
      const radiusMatchesSearch =
        !hasRadiusFilter || (distanceCenter && radiusKm && isTicketWithinRadius(ticket, distanceCenter, radiusKm));

      if (query) {
        if (searchCenter) {
          if (!textMatchesSearch && !radiusMatchesSearch) return false;
        } else {
          if (!textMatchesSearch || !radiusMatchesSearch) return false;
        }
      } else if (!radiusMatchesSearch) {
        return false;
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
  }, [
    tickets,
    searchQuery,
    priceRange,
    eventType,
    priceTagFilter,
    soldOutOnly,
    startDate,
    endDate,
    distanceCenter,
    searchCenter,
    radiusKm,
  ]);

  const sortedFilteredTickets = React.useMemo(
    () => sortTicketsByPriority(filteredTickets, distanceCenter),
    [filteredTickets, distanceCenter]
  );

  const selectedTickets = React.useMemo(() => {
    const selected = new Set(selectedTicketIds);
    return tickets.filter((ticket) => selected.has(ticket.id));
  }, [selectedTicketIds, tickets]);

  const selectedTotal = selectedTickets.reduce((sum, ticket) => sum + ticket.price, 0);
  const selectedSellerIds = Array.from(new Set(selectedTickets.map((ticket) => ticket.sellerId).filter(Boolean)));
  const selectedCurrencies = Array.from(new Set(selectedTickets.map((ticket) => ticket.currency)));
  const selectedCurrency = selectedCurrencies.length === 1 ? selectedCurrencies[0] : "CAD";
  const selectedVisibleIds = new Set(sortedFilteredTickets.map((ticket) => ticket.id));
  const selectedVisibleCount = selectedTicketIds.filter((id) => selectedVisibleIds.has(id)).length;
  const allVisibleSelected = sortedFilteredTickets.length > 0 && selectedVisibleCount === sortedFilteredTickets.length;

  function buildIdempotencyKey(ticketIds: string[]) {
    const random =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return `tickets-${ticketIds.join("-")}-${random}`.slice(0, 100);
  }

  function toggleTicketSelection(ticket: Ticket) {
    setCheckoutError(null);
    setSelectedTicketIds((current) => {
      if (current.includes(ticket.id)) return current.filter((id) => id !== ticket.id);
      if (current.length >= 10) {
        setCheckoutError("Select up to 10 tickets per checkout.");
        return current;
      }
      return [...current, ticket.id];
    });
  }

  function toggleVisibleSelection() {
    setCheckoutError(null);
    setSelectedTicketIds((current) => {
      const visibleIds = sortedFilteredTickets.map((ticket) => ticket.id);
      if (allVisibleSelected) return current.filter((id) => !selectedVisibleIds.has(id));
      const next = Array.from(new Set([...current, ...visibleIds]));
      if (next.length > 10) {
        setCheckoutError("Select up to 10 tickets per checkout.");
        return next.slice(0, 10);
      }
      return next;
    });
  }

  async function redirectForGate(status: number, data: { error?: unknown }) {
    const errorCode = String(data?.error || "").toUpperCase();
    if (status === 401 || errorCode === "NOT_AUTHENTICATED") {
      router.push(`/login?next=${encodeURIComponent("/tickets")}`);
      return true;
    }
    if (status === 403 && errorCode === "NOT_VERIFIED") {
      router.push(`/verify?next=${encodeURIComponent("/tickets")}`);
      return true;
    }
    return false;
  }

  async function checkoutSelectedTickets() {
    if (checkoutBusy) return;
    setCheckoutError(null);

    if (!selectedTicketIds.length) {
      setCheckoutError("Select at least one ticket to checkout.");
      return;
    }

    if (selectedSellerIds.length > 1) {
      setCheckoutError("For now, checkout can only include tickets from one seller.");
      return;
    }

    if (selectedCurrencies.length > 1) {
      setCheckoutError("Checkout can only include tickets listed in the same currency.");
      return;
    }

    setCheckoutBusy(true);
    try {
      const meResult = await fetchJson("/api/auth/me", { cache: "no-store" });
      const me = meResult.data;
      const user = me?.ok === true ? me.user : null;

      if (!meResult.res.ok || !user) {
        router.push(`/login?next=${encodeURIComponent("/tickets")}`);
        return;
      }

      const verified = user.flags?.isVerified === true || (!!user.emailVerifiedAt && !!user.phoneVerifiedAt);
      if (!verified) {
        router.push(`/verify?next=${encodeURIComponent("/tickets")}`);
        return;
      }

      if (user.canBuy === false) {
        setCheckoutError("Buying is disabled for this account.");
        return;
      }

      const buyerResult = await fetchJson("/api/auth/ensure-buyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!buyerResult.res.ok) {
        if (await redirectForGate(buyerResult.res.status, buyerResult.data)) return;
        setCheckoutError(buyerResult.data?.message || buyerResult.data?.error || "Could not prepare your buyer account.");
        return;
      }

      const buyerSellerId = buyerResult.data?.sellerId || user.sellerId;
      if (!buyerSellerId) {
        setCheckoutError("Could not prepare your buyer account.");
        return;
      }

      const idempotencyKey = buildIdempotencyKey(selectedTicketIds);
      const checkoutResult = await fetchJson("/api/orders/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          ticketIds: selectedTicketIds,
          buyerSellerId,
          idempotencyKey,
        }),
      });

      if (!checkoutResult.res.ok) {
        if (await redirectForGate(checkoutResult.res.status, checkoutResult.data)) return;
        setCheckoutError(checkoutResult.data?.message || checkoutResult.data?.error || "Could not reserve selected tickets.");
        return;
      }

      const orderId = checkoutResult.data?.order?.id;
      if (!orderId) {
        setCheckoutError("Could not start checkout for the selected tickets.");
        return;
      }

      router.push(`/checkout?orderId=${encodeURIComponent(orderId)}`);
    } catch {
      setCheckoutError("Network error. Please try again.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  const clearFilters = () => {
    setSearchQuery("");
    setPriceRange("all");
    setEventType("all");
    setPriceTagFilter("all");
    setSoldOutOnly(false);
    setStartDate("");
    setEndDate("");
  };

  function rememberReturnFilters() {
    writeReturnFilters({
      searchQuery,
      radiusValue,
      radiusUnit,
      eventType,
      priceRange,
      priceTagFilter,
      soldOutOnly,
      startDate,
      endDate,
    });
    markTicketReturnPending();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[#064a93] py-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-4" style={{ color: "#e6edf5" }}>Browse Tickets</h1>
            <p className="text-xl" style={{ color: "#e6edf5" }}>
              Find tickets at or below face value for your favorite events
            </p>
          </div>
          <Link
            href="/account/tickets/selling"
            className="inline-flex w-full items-center justify-center rounded-lg bg-white px-6 py-3 text-base font-bold text-[#064a93] shadow-sm transition hover:bg-blue-50 sm:w-auto"
          >
            List Tickets
          </Link>
        </div>
      </section>

      {/* Search and Filters */}
      <section className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <input
              type="text"
              placeholder="Search events, venues, artists, towns, cities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              list="browse-ticket-search-suggestions"
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <datalist id="browse-ticket-search-suggestions">
              {searchSuggestions.map((suggestion) => (
                <option
                  key={`${suggestion.type}:${suggestion.label}:${suggestion.subtitle || ""}`}
                  value={suggestion.label}
                  label={`${suggestion.type}${suggestion.subtitle ? ` - ${suggestion.subtitle}` : ""}`}
                />
              ))}
            </datalist>

            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">Within</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={radiusValue}
                  onChange={(e) => setRadiusValue(e.target.value)}
                  className="w-24 px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  aria-label="Within"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1">Unit</label>
                <select
                  value={radiusUnit}
                  onChange={(e) => setRadiusUnit(e.target.value as RadiusUnit)}
                  className="px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  aria-label="Unit"
                >
                  <option value="km">km</option>
                  <option value="mi">miles</option>
                </select>
              </div>
            </div>

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

            {(searchQuery || eventType !== "all" || priceRange !== "all" || priceTagFilter !== "all" || soldOutOnly || startDate || endDate || radiusValue !== "50" || radiusUnit !== "km") && (
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
            <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-gray-600 dark:text-gray-400">
                  {loading ? "Loading tickets..." : `${sortedFilteredTickets.length} ticket${sortedFilteredTickets.length !== 1 ? "s" : ""} found`}
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {selectedTicketIds.length} selected · {formatMoney(selectedTotal, selectedCurrency)} {selectedCurrency} subtotal
                </p>
                {checkoutError ? <p className="mt-1 text-sm font-semibold text-red-600">{checkoutError}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleVisibleSelection}
                  disabled={!sortedFilteredTickets.length || checkoutBusy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                >
                  {allVisibleSelected ? "Clear visible" : "Select visible"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTicketIds([]);
                    setCheckoutError(null);
                  }}
                  disabled={!selectedTicketIds.length || checkoutBusy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                >
                  Clear selection
                </button>
                <button
                  type="button"
                  onClick={checkoutSelectedTickets}
                  disabled={!selectedTicketIds.length || checkoutBusy}
                  className="rounded-lg bg-[#064a93] px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-900 disabled:opacity-50"
                >
                  {checkoutBusy ? "Preparing checkout..." : "Checkout selected"}
                </button>
              </div>
            </div>
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
              {sortedFilteredTickets.map((ticket) => {
                const selected = selectedTicketIds.includes(ticket.id);

                return (
                  <div key={ticket.id} className="min-w-[18rem] max-w-[18rem] snap-start sm:min-w-0 sm:max-w-none">
                    <label className="mb-2 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-900 shadow ring-1 ring-gray-200 dark:bg-gray-900 dark:text-white dark:ring-gray-700">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleTicketSelection(ticket)}
                        className="h-5 w-5 rounded border-gray-300"
                      />
                      Select
                    </label>
                    <TicketCard ticket={ticket} onViewTicket={rememberReturnFilters} />
                    <button
                      type="button"
                      onClick={() => toggleTicketSelection(ticket)}
                      className={`mt-2 w-full rounded-lg border px-4 py-2 text-sm font-bold transition ${
                        selected
                          ? "border-[#064a93] bg-[#064a93] text-white hover:bg-blue-900"
                          : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
                      }`}
                    >
                      {selected ? "Selected" : "Select ticket"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
