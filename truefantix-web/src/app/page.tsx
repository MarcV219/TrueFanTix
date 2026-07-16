"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import TicketCard from "@/components/tickets/TicketCard";
import { fetchJson } from "@/lib/api-fetch";
import { formatMoney, inferCoordsFromCity as sharedInferCoordsFromCity, mapApiTicketToCard, rankFeaturedTickets } from "@/lib/ticketsView";
import type { FeaturedTicketPreference, TicketCardView } from "@/lib/ticketsView";

type ApiTicket = {
  id: string;
  title: string;
  date: string;
  venue: string;
  row: string | null;
  seat: string | null;
  price: number;
  faceValue: number | null;
  status: "AVAILABLE" | "SOLD";
  image: string;
  sellerId: string;
  seller: null | {
    id: string;
    name: string;
    rating: number;
    reviews: number;
    accessTokenBalance: number;
    badges: string[];
  };
  event?: {
    selloutStatus?: "SOLD_OUT" | "NOT_SOLD_OUT" | string;
  } | null;
};

type TicketsResponse = {
  error?: string;
  tickets?: ApiTicket[];
  nextCursor?: string | null;
};

type ApiForumThread = {
  id: string;
  title: string;
  topicType: "ARTIST" | "TEAM" | "SHOW" | "OTHER";
  topic: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { posts?: number };
};

type ForumThreadPreview = {
  id: string;
  title: string;
  topicType: ApiForumThread["topicType"];
  topic: string | null;
  updatedAt: string | null;
  replies: number;
};

type ForumThreadsResponse = {
  threads?: ApiForumThread[];
  items?: ApiForumThread[];
};

type AuthMeResponse = {
  user?: {
    city?: string | null;
  } | null;
};

type PreferencesResponse = {
  preferences?: FeaturedTicketPreference[];
  settings?: {
    notificationRadiusKm?: number | null;
  };
};

function formatForumTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function topicTypeLabel(t: ForumThreadPreview["topicType"]) {
  if (t === "ARTIST") return "Artist";
  if (t === "TEAM") return "Team";
  if (t === "SHOW") return "Show";
  return "Other";
}

async function fetchForumThreadsPreview(): Promise<ForumThreadPreview[]> {
  try {
    const res = await fetch("/api/forum/threads?take=6", { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json() as ApiForumThread[] | ForumThreadsResponse;
    const raw: ApiForumThread[] = Array.isArray(json) ? json : Array.isArray(json?.threads) ? json.threads : Array.isArray(json?.items) ? json.items : [];
    return raw.map((t) => ({
      id: t.id,
      title: t.title,
      topicType: t.topicType,
      topic: t.topic ?? null,
      updatedAt: t.updatedAt ?? null,
      replies: Math.max(0, (t._count?.posts ?? 0) - 1),
    }));
  } catch {
    return [];
  }
}

const BRAND = {
  pageBg: "bg-[var(--background)] text-[var(--foreground)]",
  title: "text-[var(--tft-navy)] dark:text-[var(--foreground)]",
  subtle: "text-gray-600 dark:text-gray-300",
  link: "text-[var(--tft-teal)] hover:text-[var(--tft-teal-dark)]",
  btnPrimary: "button-primary px-6 py-3 rounded-lg shadow-sm hover:shadow transition disabled:opacity-50",
  btnSecondary: "px-6 py-3 rounded-lg border border-[var(--tft-navy)] text-[var(--tft-navy)] hover:bg-[rgba(6,74,147,0.06)] transition disabled:opacity-50",
  btnPrimarySm: "button-primary px-4 py-2 rounded-lg shadow-sm hover:shadow transition disabled:opacity-50",
  btnOutline: "px-4 py-2 rounded-lg border border-[var(--tft-navy)] text-[var(--tft-navy)] hover:bg-[rgba(6,74,147,0.06)] transition",
  pillBrand: "bg-[rgba(6,74,147,0.10)] text-[var(--tft-navy)]",
  pillNeutral: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
};

function ChevronLeftIcon({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6" /></svg>;
}

function ChevronRightIcon({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6" /></svg>;
}

export default function Page() {
  const router = useRouter();
  const [allTickets, setAllTickets] = React.useState<TicketCardView[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [selectedTicketIds, setSelectedTicketIds] = React.useState<string[]>([]);
  const [checkoutBusy, setCheckoutBusy] = React.useState(false);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [userCoords, setUserCoords] = React.useState<{ lat: number; lon: number } | null>(null);
  const [notificationRadiusKm, setNotificationRadiusKm] = React.useState<number | null>(null);
  const [notificationPreferences, setNotificationPreferences] = React.useState<FeaturedTicketPreference[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [forumLoading, setForumLoading] = React.useState(true);
  const [forumThreads, setForumThreads] = React.useState<ForumThreadPreview[]>([]);

  const TICKETS_PER_PAGE = 4;

  React.useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);
        const rawTickets: ApiTicket[] = [];
        let cursor: string | null = null;

        do {
          const params = new URLSearchParams({ status: "AVAILABLE", take: "500" });
          if (cursor) params.set("cursor", cursor);

          const res = await fetch(`/api/tickets?${params.toString()}`, { cache: "no-store" });
          const json = await res.json() as ApiTicket[] | TicketsResponse;

          if (!res.ok) {
            const message = Array.isArray(json) ? undefined : json.error;
            throw new Error(message || `Tickets fetch failed (${res.status})`);
          }

          const pageTickets: ApiTicket[] = Array.isArray(json) ? json : Array.isArray(json?.tickets) ? json.tickets : [];
          rawTickets.push(...pageTickets);
          cursor = !Array.isArray(json) && typeof json.nextCursor === "string" && json.nextCursor ? json.nextCursor : null;
        } while (cursor && alive);

        if (!alive) return;

        const normalized: TicketCardView[] = rawTickets
          .filter((t) => t.status === "AVAILABLE")
          .map((t) => mapApiTicketToCard(t));

        if (!alive) return;
        setAllTickets(normalized);
        setCurrentIndex(0);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setAllTickets([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setForumLoading(true);
        const threads = await fetchForumThreadsPreview();
        if (!alive) return;
        setForumThreads(threads.slice(0, 6));
      } finally {
        if (alive) setForumLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadUserLocation() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json().catch(() => ({})) as AuthMeResponse;
        const city = json?.user?.city as string | undefined;
        const fromProfile = sharedInferCoordsFromCity(city);
        if (!cancelled && fromProfile) {
          setUserCoords(fromProfile);
          return;
        }
      } catch {
        // ignore, fallback to browser geolocation below
      }

      try {
        const prefRes = await fetch("/api/notifications/preferences", { cache: "no-store" });
        const prefJson = await prefRes.json().catch(() => ({})) as PreferencesResponse;
        if (!cancelled && prefRes.ok) {
          const preferences = Array.isArray(prefJson?.preferences) ? prefJson.preferences as FeaturedTicketPreference[] : [];
          const radiusKm = Number(prefJson?.settings?.notificationRadiusKm);
          setNotificationPreferences(preferences.filter((preference) => String(preference.status ?? "ACTIVE").toUpperCase() === "ACTIVE"));
          setNotificationRadiusKm(Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : null);
        }
      } catch {
        // Guests and signed-out users simply get public relevance scoring.
      }

      // Fallback for guests / users without profile city mapping
      if (typeof window !== 'undefined' && navigator.geolocation && !cancelled) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!cancelled) setUserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          },
          () => {
            // Ignore denied/unavailable location and keep deterministic fallback sorting.
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

  const sortedTickets = React.useMemo(
    () => rankFeaturedTickets(allTickets, {
      userCoords,
      notificationRadiusKm,
      preferences: notificationPreferences,
    }),
    [allTickets, notificationPreferences, notificationRadiusKm, userCoords]
  );

  const displayedTickets = React.useMemo(
    () => sortedTickets.slice(currentIndex, currentIndex + TICKETS_PER_PAGE),
    [sortedTickets, currentIndex, TICKETS_PER_PAGE]
  );
  const maxFeaturedIndex = Math.max(0, sortedTickets.length - TICKETS_PER_PAGE);

  React.useEffect(() => {
    setCurrentIndex((index) => Math.min(index, maxFeaturedIndex));
  }, [maxFeaturedIndex]);

  const selectedTickets = React.useMemo(() => {
    const selected = new Set(selectedTicketIds);
    return allTickets.filter((ticket) => selected.has(ticket.id));
  }, [allTickets, selectedTicketIds]);
  const selectedTotal = selectedTickets.reduce((sum, ticket) => sum + ticket.price, 0);
  const selectedSellerIds = Array.from(new Set(selectedTickets.map((ticket) => ticket.sellerId).filter(Boolean)));
  const selectedCurrencies = Array.from(new Set(selectedTickets.map((ticket) => ticket.currency)));
  const selectedCurrency = selectedCurrencies.length === 1 ? selectedCurrencies[0] : "CAD";
  const displayedIds = new Set(displayedTickets.map((ticket) => ticket.id));
  const selectedDisplayedCount = selectedTicketIds.filter((id) => displayedIds.has(id)).length;
  const allDisplayedSelected = displayedTickets.length > 0 && selectedDisplayedCount === displayedTickets.length;

  const handlePrev = () => {
    const newIndex = Math.max(0, currentIndex - TICKETS_PER_PAGE);
    setCurrentIndex(newIndex);
  };

  const handleNext = () => {
    const newIndex = Math.min(sortedTickets.length - TICKETS_PER_PAGE, currentIndex + TICKETS_PER_PAGE);
    if (newIndex > currentIndex) {
      setCurrentIndex(newIndex);
    }
  };

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex + TICKETS_PER_PAGE < sortedTickets.length;
  const showFeaturedControls = sortedTickets.length > TICKETS_PER_PAGE;

  function buildIdempotencyKey(ticketIds: string[]) {
    const random =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return `tickets-${ticketIds.join("-")}-${random}`.slice(0, 100);
  }

  function toggleTicketSelection(ticket: TicketCardView) {
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

  function toggleDisplayedSelection() {
    setCheckoutError(null);
    setSelectedTicketIds((current) => {
      const visibleIds = displayedTickets.map((ticket) => ticket.id);
      if (allDisplayedSelected) return current.filter((id) => !displayedIds.has(id));
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
      router.push(`/login?next=${encodeURIComponent("/")}`);
      return true;
    }
    if (status === 403 && errorCode === "NOT_VERIFIED") {
      router.push(`/verify?next=${encodeURIComponent("/")}`);
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
        router.push(`/login?next=${encodeURIComponent("/")}`);
        return;
      }

      const verified = user.flags?.isVerified === true || (!!user.emailVerifiedAt && !!user.phoneVerifiedAt);
      if (!verified) {
        router.push(`/verify?next=${encodeURIComponent("/")}`);
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

  return (
    <div className={`min-h-screen flex flex-col ${BRAND.pageBg}`}>
      <section className="relative text-center py-16 bg-white/70 dark:bg-white/5 border-b border-[var(--border)] overflow-hidden">
        <div className="pointer-events-none select-none hidden lg:block absolute left-10 top-1/2 -translate-y-1/2 opacity-100">
          <Image src="/brand/truefantix-lockup.jpeg" alt="" width={360} height={360} className="w-[360px] h-[360px] object-contain" priority={false} />
        </div>
        <div className="pointer-events-none select-none hidden lg:block absolute right-10 top-1/2 -translate-y-1/2 opacity-100">
          <Image src="/brand/truefantix-lockup.jpeg" alt="" width={360} height={360} className="w-[360px] h-[360px] object-contain" priority={false} />
        </div>

        <div className="relative z-10 px-4">
          <h1 className={`text-5xl font-bold mb-4 ${BRAND.title}`}>Welcome to <span className="text-[var(--tft-navy)]">TrueFan</span><span className="text-[var(--tft-teal)]">Tix</span></h1>
          <p className={`text-lg mb-6 ${BRAND.subtle}`}>Buy and sell tickets at or below face value. Secure, fair, and fan-first.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/tickets" className={BRAND.btnPrimary}>Browse Tickets</Link>
            <Link href="/account/tickets/selling" className={BRAND.btnSecondary}>List Tickets for Sale</Link>
          </div>
        </div>
      </section>

      <section id="featured-tickets" className="p-6 sm:p-8">
        <h2 className={`text-3xl font-bold mb-6 text-center ${BRAND.title}`}>Featured Tickets</h2>

        {loading && <div className={`max-w-7xl mx-auto text-center ${BRAND.subtle}`}>Loading tickets…</div>}

        {!loading && error && (
          <div className="max-w-7xl mx-auto text-center">
            <div className="text-red-600 font-semibold">Could not load tickets</div>
            <div className={`text-sm mt-1 ${BRAND.subtle}`}>{error}</div>
          </div>
        )}

        {!loading && !error && allTickets.length > 0 && (
          <div className="max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className={`text-sm ${BRAND.subtle}`}>Select featured tickets to checkout directly.</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {selectedTicketIds.length} selected · {formatMoney(selectedTotal, selectedCurrency)} {selectedCurrency} subtotal
                </p>
                {checkoutError ? <p className="mt-1 text-sm font-semibold text-red-600">{checkoutError}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleDisplayedSelection}
                  disabled={!displayedTickets.length || checkoutBusy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                >
                  {allDisplayedSelected ? "Clear visible" : "Select visible"}
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
            <div className="relative flex items-center gap-4">
              {showFeaturedControls ? (
                <button
                  onClick={handlePrev}
                  disabled={!canGoPrev}
                  className="hidden sm:flex flex-shrink-0 w-12 h-12 rounded-full bg-white dark:bg-white/10 shadow-lg border border-[var(--border)] items-center justify-center disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Previous tickets"
                >
                  <ChevronLeftIcon className="w-6 h-6" />
                </button>
              ) : null}

              <div className="flex-1 min-w-0 flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0 lg:grid-cols-4">
                {displayedTickets.map((ticket) => {
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
                      <TicketCard ticket={ticket} />
                      {ticket.featuredReasons.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {ticket.featuredReasons.slice(0, 2).map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full bg-[rgba(6,74,147,0.08)] px-2.5 py-1 text-xs font-bold text-[var(--tft-navy)] ring-1 ring-[rgba(6,74,147,0.16)] dark:bg-white/10 dark:text-white dark:ring-white/15"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
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

              {showFeaturedControls ? (
                <button
                  onClick={handleNext}
                  disabled={!canGoNext}
                  className="hidden sm:flex flex-shrink-0 w-12 h-12 rounded-full bg-white dark:bg-white/10 shadow-lg border border-[var(--border)] items-center justify-center disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Next tickets"
                >
                  <ChevronRightIcon className="w-6 h-6" />
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <section className="px-6 sm:px-8 pb-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className={`text-3xl font-bold ${BRAND.title}`}>Community Forum</h2>
              <p className={`${BRAND.subtle} mt-1`}>Latest discussions (showing up to 6).</p>
            </div>
            <Link href="/forum" className={`shrink-0 ${BRAND.btnPrimarySm} inline-flex items-center justify-center`}>View all discussions</Link>
          </div>

          <div className="bg-white/95 dark:bg-white/5 rounded-xl shadow-lg border border-[var(--border)]">
            {forumLoading ? (
              <div className={`p-6 ${BRAND.subtle}`}>Loading latest discussions…</div>
            ) : forumThreads.length === 0 ? (
              <div className="p-6">No discussions yet</div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {forumThreads.slice(0, 6).map((t) => (
                  <li key={t.id} className="p-5 hover:bg-black/5 dark:hover:bg-white/5 transition">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${BRAND.pillBrand}`}>{topicTypeLabel(t.topicType)}</span>
                          {t.topic && <span className={`text-xs font-semibold px-2 py-1 rounded-full ${BRAND.pillNeutral}`}>{t.topic}</span>}
                          <Link href={`/forum/threads/${t.id}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--tft-teal)] truncate" title={t.title}>{t.title}</Link>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{t.updatedAt ? `Updated ${formatForumTime(t.updatedAt)}` : ""}</div>
                      </div>
                      <div className={`shrink-0 text-sm ${BRAND.subtle}`}><span className="px-2 py-1 rounded bg-gray-100 dark:bg-white/10">{t.replies} repl{t.replies === 1 ? "y" : "ies"}</span></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
