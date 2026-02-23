"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import Footer from "@/components/Footer";

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
    creditBalance: number;
    badges: string[];
  };
  event?: {
    selloutStatus?: "SOLD_OUT" | "NOT_SOLD_OUT" | string;
  } | null;
};

type TicketCard = {
  id: string;
  title: string;
  date: string;
  venue: string;
  row: string | null;
  seat: string | null;
  price: number;
  image: string;
  sellerId: string;
  badges: string[];
  rating: number;
  reviews: number;
  priceTag: "Face Value" | "Below Face Value";
  eventType: string;
  eventTypeLabel: string;
  isSoldOut: boolean;
  placeholderImage: string;
  dynamicImage?: string;
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

const badgeTooltips: Record<string, string> = {
  VIP: "VIP Access",
  Verified: "Verified Seller",
  "Early Access": "Early Access Ticket",
};

const DEFAULT_IMAGE = "/default.jpg";

function resolveTicketImageSrc(raw: unknown) {
  let s = String(raw ?? "").trim();
  if (!s) return DEFAULT_IMAGE;

  const winPublicIdx = s.toLowerCase().lastIndexOf("\\public\\");
  if (winPublicIdx !== -1) s = s.slice(winPublicIdx + "\\public\\".length).replaceAll("\\", "/");

  if (s.toLowerCase().startsWith("public/")) s = s.slice("public/".length);
  if (s.toLowerCase().startsWith("/public/")) s = s.slice("/public/".length);

  if (s === "/img" || s.startsWith("/img?") || s.startsWith("/img/")) return DEFAULT_IMAGE;
  if (s === "img" || s.startsWith("img?") || s.startsWith("img/")) return DEFAULT_IMAGE;

  if (s === "/seed-image" || s.startsWith("/seed-image?") || s.startsWith("/seed-image/")) return DEFAULT_IMAGE;
  if (s === "seed-image" || s.startsWith("seed-image?") || s.startsWith("seed-image/")) return DEFAULT_IMAGE;

  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

function computePriceTag(price: number, faceValue: number | null, isSoldOut = false): TicketCard["priceTag"] {
  if (isSoldOut) return "Face Value";
  if (faceValue == null) return "Face Value";
  return price < faceValue ? "Below Face Value" : "Face Value";
}

function getEventType(title: string): { type: string; label: string; placeholder: string } {
  const lower = title.toLowerCase();

  if (lower.match(/raptors|basketball/)) return { type: "sports-basketball", label: "Sports: Basketball", placeholder: "/basketball-placeholder.jpg" };
  if (lower.match(/leafs|hockey/)) return { type: "sports-hockey", label: "Sports: Hockey", placeholder: "/hockey-placeholder.jpg" };
  if (lower.match(/blue jays|baseball/)) return { type: "sports-baseball", label: "Sports: Baseball", placeholder: "/sports-placeholder.jpg" };
  if (lower.includes("football") && !lower.includes("hockey")) return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  if (lower.includes("soccer")) return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  if (lower.includes("lacrosse")) return { type: "sports-lacrosse", label: "Sports: Lacrosse", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/argos|argonauts/)) return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  if (lower.match(/tfc|toronto fc/)) return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/sports|vs\.|game/)) return { type: "sports-other", label: "Sports: Other", placeholder: "/sports-placeholder.jpg" };

  if (lower.match(/taylor swift|drake|ed sheeran|weeknd|concert|tour|live music/)) return { type: "concert", label: "Concert", placeholder: "/concert-placeholder.jpg" };
  if (lower.match(/hamilton|theatre|theater|broadway|play/)) return { type: "theatre", label: "Theatre", placeholder: "/theatre-placeholder.jpg" };
  if (lower.match(/comedy|stand.up|comedian|funny/)) return { type: "comedy", label: "Comedy", placeholder: "/comedy-placeholder.jpg" };
  if (lower.match(/conference|summit|convention/)) return { type: "conference", label: "Conference", placeholder: "/conference-placeholder.jpg" };
  if (lower.match(/festival|music fest|coachella/)) return { type: "festival", label: "Festival", placeholder: "/festival-placeholder.jpg" };
  if (lower.match(/gala|ball|charity dinner/)) return { type: "gala", label: "Gala", placeholder: "/gala-placeholder.jpg" };
  if (lower.match(/opera|symphony|orchestra/)) return { type: "opera", label: "Opera", placeholder: "/opera-placeholder.jpg" };
  if (lower.match(/workshop|seminar|class|training/)) return { type: "workshop", label: "Workshop", placeholder: "/workshop-placeholder.jpg" };

  return { type: "other", label: "Other", placeholder: "/default.jpg" };
}

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

    const json: unknown = await res.json();
    const payload = json as { threads?: ApiForumThread[]; items?: ApiForumThread[] } | ApiForumThread[];
    const raw: ApiForumThread[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.threads)
      ? payload.threads
      : Array.isArray(payload?.items)
      ? payload.items
      : [];

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
  const [allTickets, setAllTickets] = React.useState<TicketCard[]>([]);
  const [displayedTickets, setDisplayedTickets] = React.useState<TicketCard[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [forumLoading, setForumLoading] = React.useState(true);
  const [forumThreads, setForumThreads] = React.useState<ForumThreadPreview[]>([]);
  const [waitlistEmail, setWaitlistEmail] = React.useState("");
  const [waitlistStatus, setWaitlistStatus] = React.useState<{type:"idle"}|{type:"loading"}|{type:"success";message:string}|{type:"error";message:string}>({ type: "idle" });

  const TICKETS_PER_PAGE = 4;

  React.useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/tickets?status=AVAILABLE&take=100", { cache: "no-store" });
        const json: unknown = await res.json();
        const payload = json as { tickets?: ApiTicket[]; error?: string } | ApiTicket[];
        const rawTickets: ApiTicket[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.tickets)
          ? payload.tickets
          : [];

        if (!res.ok) {
          const message = !Array.isArray(payload) && typeof payload?.error === "string"
            ? payload.error
            : `Tickets fetch failed (${res.status})`;
          throw new Error(message);
        }

        const normalized: TicketCard[] = rawTickets
          .filter((t) => t.status === "AVAILABLE")
          .map((t) => {
            const seller = t.seller;
            const eventTypeInfo = getEventType(t.title);
            const isSoldOut = t.event?.selloutStatus === "SOLD_OUT";
            return {
              id: t.id,
              title: t.title,
              date: t.date,
              venue: t.venue,
              row: t.row ?? null,
              seat: t.seat ?? null,
              price: Number(t.price ?? 0),
              image: resolveTicketImageSrc(t.image),
              sellerId: t.sellerId,
              badges: seller?.badges ?? [],
              rating: seller?.rating ?? 0,
              reviews: seller?.reviews ?? 0,
              priceTag: computePriceTag(Number(t.price ?? 0), t.faceValue ?? null, isSoldOut),
              eventType: eventTypeInfo.type,
              eventTypeLabel: eventTypeInfo.label,
              isSoldOut,
              placeholderImage: eventTypeInfo.placeholder,
            };
          });

        if (!alive) return;
        setAllTickets(normalized);
        setDisplayedTickets(normalized.slice(0, TICKETS_PER_PAGE));
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setAllTickets([]);
        setDisplayedTickets([]);
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

  const handlePrev = () => {
    const newIndex = Math.max(0, currentIndex - TICKETS_PER_PAGE);
    setCurrentIndex(newIndex);
    setDisplayedTickets(allTickets.slice(newIndex, newIndex + TICKETS_PER_PAGE));
  };

  const handleNext = () => {
    const newIndex = Math.min(allTickets.length - TICKETS_PER_PAGE, currentIndex + TICKETS_PER_PAGE);
    if (newIndex > currentIndex) {
      setCurrentIndex(newIndex);
      setDisplayedTickets(allTickets.slice(newIndex, newIndex + TICKETS_PER_PAGE));
    }
  };

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex + TICKETS_PER_PAGE < allTickets.length;

  async function submitWaitlist(e: React.FormEvent) {
    e.preventDefault();
    const email = waitlistEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setWaitlistStatus({ type: "error", message: "Please enter a valid email address." });
      return;
    }

    try {
      setWaitlistStatus({ type: "loading" });
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "homepage" }),
      });
      const json: unknown = await res.json().catch(() => ({}));
      const payload = json as { message?: string; error?: string };
      if (!res.ok) {
        setWaitlistStatus({
          type: "error",
          message: payload?.message || payload?.error || "Could not join right now.",
        });
        return;
      }
      setWaitlistEmail("");
      setWaitlistStatus({ type: "success", message: "You’re in! We’ll email you when Early Access opens." });
    } catch {
      setWaitlistStatus({ type: "error", message: "Network error. Please try again." });
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
            <a href="#early-access" className={BRAND.btnOutline}>Join the Early Access List</a>
          </div>

          <div id="early-access" className="mt-10 max-w-xl mx-auto">
            <div className="rounded-2xl border border-[var(--border)] bg-white/90 dark:bg-white/5 shadow-sm p-5 text-left">
              <div className={`text-xl font-bold ${BRAND.title}`}>Join the Early Access List</div>
              <div className={`text-sm mt-1 ${BRAND.subtle}`}>Be first to access fair-priced tickets. Early supporters get priority access at launch.</div>
              <form onSubmit={submitWaitlist} className="mt-4 flex flex-col sm:flex-row gap-3">
                <input value={waitlistEmail} onChange={(e) => setWaitlistEmail(e.target.value)} type="email" placeholder="you@email.com" className="flex-1 px-4 py-3 rounded-lg border border-[var(--border)] bg-white dark:bg-black/20" />
                <button type="submit" className={BRAND.btnPrimarySm} disabled={waitlistStatus.type === "loading"}>{waitlistStatus.type === "loading" ? "Submitting…" : "Get Early Access"}</button>
              </form>
              {waitlistStatus.type === "success" && <div className="mt-3 text-sm font-semibold text-green-700">{waitlistStatus.message}</div>}
              {waitlistStatus.type === "error" && <div className="mt-3 text-sm font-semibold text-red-600">{waitlistStatus.message}</div>}
            </div>
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
            <div className="relative flex items-center gap-4">
              <button onClick={handlePrev} disabled={!canGoPrev} className="flex-shrink-0 w-12 h-12 rounded-full bg-white dark:bg-white/10 shadow-lg border border-[var(--border)] flex items-center justify-center" aria-label="Previous tickets">
                <ChevronLeftIcon className="w-6 h-6" />
              </button>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {displayedTickets.map((ticket) => (
                  <div key={ticket.id} className="bg-white/95 dark:bg-white/5 rounded-xl shadow-lg flex flex-col border border-[var(--border)]">
                    <div className="relative">
                      <Image
                        src={`${ticket.dynamicImage || ticket.placeholderImage || DEFAULT_IMAGE}?v=2`}
                        alt={ticket.title}
                        width={640}
                        height={360}
                        className="rounded-t-xl object-cover w-full h-48"
                      />
                      <span className="absolute top-2 right-2 px-2 py-1 text-xs font-semibold rounded bg-gray-800 text-white">{ticket.eventTypeLabel}</span>
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {ticket.badges.map((badge, i) => (
                          <span
                            key={`${badge}-${i}`}
                            title={badgeTooltips[badge] ?? badge}
                            className="text-xs px-2 py-1 rounded-full font-semibold bg-[rgba(6,74,147,0.10)] text-[var(--tft-navy)]"
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                      <h4 className="font-bold text-lg text-[var(--foreground)]">{ticket.title}</h4>
                      <p className={BRAND.subtle}>{ticket.date}</p>
                      <p className={`${BRAND.subtle} mb-2`}>{ticket.venue}</p>
                      {(ticket.row || ticket.seat) && <p className="text-sm font-medium text-[var(--tft-navy)] mb-2">{ticket.row && `Row ${ticket.row}`}{ticket.row && ticket.seat && " • "}{ticket.seat && `Seat ${ticket.seat}`}</p>}
                      <p className="font-semibold text-[var(--tft-navy)] mb-4">${ticket.price.toFixed(2)}</p>
                      <Link href={`/tickets/${ticket.id}`} className="mt-auto text-center button-primary py-2 rounded transition shadow-sm hover:shadow">View Ticket</Link>
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={handleNext} disabled={!canGoNext} className="flex-shrink-0 w-12 h-12 rounded-full bg-white dark:bg-white/10 shadow-lg border border-[var(--border)] flex items-center justify-center" aria-label="Next tickets">
                <ChevronRightIcon className="w-6 h-6" />
              </button>
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
