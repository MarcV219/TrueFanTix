"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";

type ApiTicket = {
  id: string;
  title: string;
  date: string;
  venue: string;
  row: string | null;
  seat: string | null;

  // from your API
  price: number; // dollars (computed from cents)
  faceValue: number | null; // dollars (computed from cents)
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

// Forum API shapes (based on your /api/forum/threads GET)
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
  if (winPublicIdx !== -1) {
    s = s.slice(winPublicIdx + "\\public\\".length).replaceAll("\\", "/");
  }

  if (s.toLowerCase().startsWith("public/")) s = s.slice("public/".length);
  if (s.toLowerCase().startsWith("/public/")) s = s.slice("/public/".length);

  if (s === "/img" || s.startsWith("/img?") || s.startsWith("/img/")) return DEFAULT_IMAGE;
  if (s === "img" || s.startsWith("img?") || s.startsWith("img/")) return DEFAULT_IMAGE;

  if (s === "/seed-image" || s.startsWith("/seed-image?") || s.startsWith("/seed-image/"))
    return DEFAULT_IMAGE;
  if (s === "seed-image" || s.startsWith("seed-image?") || s.startsWith("seed-image/"))
    return DEFAULT_IMAGE;

  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  if (!s.startsWith("/")) s = `/${s}`;

  return s;
}

function computePriceTag(price: number, faceValue: number | null, isSoldOut: boolean = false): TicketCard["priceTag"] {
  if (isSoldOut) return "Face Value";
  if (faceValue == null) return "Face Value";
  return price < faceValue ? "Below Face Value" : "Face Value";
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

/**
 * Pull latest 6 visible threads.
 * Your API returns: { ok:true, items:[...], nextCursor }
 */
async function fetchForumThreadsPreview(): Promise<ForumThreadPreview[]> {
  try {
    const res = await fetch("/api/forum/threads?limit=6", { cache: "no-store" });
    if (!res.ok) return [];

    const json: any = await res.json();
    const items: ApiForumThread[] = Array.isArray(json?.items) ? json.items : [];

    return items.slice(0, 6).map((t) => {
      const posts = typeof t._count?.posts === "number" ? t._count.posts : 0;
      const replies = Math.max(0, posts - 1);

      return {
        id: String(t.id),
        title: String(t.title ?? "Untitled thread"),
        topicType: (t.topicType ?? "OTHER") as ForumThreadPreview["topicType"],
        topic: t.topic ?? null,
        updatedAt: t.updatedAt ?? null,
        replies,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Brand utility classes using your globals.css tokens.
 * (Keeps JSX readable + consistent.)
 */
const BRAND = {
  pageBg: "bg-[var(--background)] text-[var(--foreground)]",
  panel: "bg-white/95 dark:bg-white/5 border border-[var(--border)]",
  title: "text-[var(--tft-navy)] dark:text-[var(--foreground)]",
  subtle: "text-gray-600 dark:text-gray-300",
  link: "text-[var(--tft-teal)] hover:text-[var(--tft-teal-dark)]",
  btnPrimary:
    "button-primary px-6 py-3 rounded-lg shadow-sm hover:shadow transition disabled:opacity-50",
  btnPrimarySm:
    "button-primary px-4 py-2 rounded-lg shadow-sm hover:shadow transition disabled:opacity-50",
  btnOutline:
    "px-4 py-2 rounded-lg border border-[var(--tft-navy)] text-[var(--tft-navy)] hover:bg-[rgba(6,74,147,0.06)] transition",
  pillBrand: "bg-[rgba(6,74,147,0.10)] text-[var(--tft-navy)]",
  pillNeutral: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
};

// ChevronLeft Icon Component
function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

// ChevronRight Icon Component
function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export default function Page() {
  const router = useRouter();

  const [allTickets, setAllTickets] = React.useState<TicketCard[]>([]);
  const [displayedTickets, setDisplayedTickets] = React.useState<TicketCard[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Forum preview state
  const [forumLoading, setForumLoading] = React.useState(true);
  const [forumThreads, setForumThreads] = React.useState<ForumThreadPreview[]>([]);

  const TICKETS_PER_PAGE = 4;

  React.useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/tickets?status=AVAILABLE&take=100", { cache: "no-store" });
        const json = (await res.json()) as any;
        const rawTickets: ApiTicket[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.tickets)
          ? json.tickets
          : [];

        if (!res.ok) {
          throw new Error((json as any)?.error || `Tickets fetch failed (${res.status})`);
        }

        const available = rawTickets.filter((t) => t.status === "AVAILABLE");

        const normalized: TicketCard[] = available.map((t) => {
          const seller = t.seller;
          const eventTypeInfo = getEventType(t.title);
          const isSoldOut = t.event?.selloutStatus === "SOLD_OUT" || false;

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
        
        // Fetch dynamic images for tickets
        fetchImagesForTickets(normalized);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Unknown error");
        setAllTickets([]);
        setDisplayedTickets([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    async function fetchImagesForTickets(ticketList: TicketCard[]) {
      // Use Promise.all to fetch all images in parallel
      const imagePromises = ticketList.map(async (ticket) => {
        try {
          const res = await fetch(
            `/api/tickets/image?title=${encodeURIComponent(ticket.title)}&eventType=${encodeURIComponent(ticket.eventType)}`
          );
          
          if (res.ok) {
            const data = await res.json();
            if (data.imageUrl && !data.isPlaceholder) {
              return { ...ticket, dynamicImage: data.imageUrl };
            }
          }
        } catch (e) {
          // Silently fail and use placeholder
        }
        return ticket;
      });
      
      const updatedTickets = await Promise.all(imagePromises);
      
      if (alive) {
        setAllTickets(updatedTickets);
        setDisplayedTickets(updatedTickets.slice(currentIndex, currentIndex + TICKETS_PER_PAGE));
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  // Load forum preview (latest 6 threads)
  React.useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setForumLoading(true);
        const threads = await fetchForumThreadsPreview();
        if (!alive) return;
        setForumThreads(threads.slice(0, 6));
      } finally {
        if (alive) setForumLoading(false);
      }
    }

    run();
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

  return (
    <div className={`min-h-screen flex flex-col ${BRAND.pageBg}`}>
      {/* Hero */}
      <section className="relative text-center py-16 bg-white/70 dark:bg-white/5 border-b border-[var(--border)] overflow-hidden">
        {/* Decorative side logos (desktop+) — original opacity */}
        <div className="pointer-events-none select-none hidden lg:block absolute left-10 top-1/2 -translate-y-1/2 opacity-100">
          <Image
            src="/brand/truefantix-lockup.jpeg"
            alt=""
            width={360}
            height={360}
            className="w-[360px] h-[360px] object-contain"
            priority={false}
          />
        </div>

        <div className="pointer-events-none select-none hidden lg:block absolute right-10 top-1/2 -translate-y-1/2 opacity-100">
          <Image
            src="/brand/truefantix-lockup.jpeg"
            alt=""
            width={360}
            height={360}
            className="w-[360px] h-[360px] object-contain"
            priority={false}
          />
        </div>

        {/* Content */}
        <div className="relative z-10">
          <h1 className={`text-5xl font-bold mb-4 ${BRAND.title}`}>
            Welcome to{" "}
            <span className="inline-flex items-baseline">
              <span className="text-[var(--tft-navy)]">TrueFan</span>
              <span className="text-[var(--tft-teal)]">Tix</span>
            </span>
          </h1>

          <p className={`text-lg mb-6 ${BRAND.subtle}`}>
            Buy and sell tickets at or below face value. Secure, fair, and fan-first.
          </p>

          <Link
            href="/tickets"
            className={BRAND.btnPrimary}
          >
            Browse Tickets
          </Link>
        </div>
      </section>

      {/* Tickets Carousel */}
      <section id="featured-tickets" className="p-6 sm:p-8">
        <h2 className={`text-3xl font-bold mb-6 text-center ${BRAND.title}`}>Featured Tickets</h2>

        {loading && (
          <div className={`max-w-7xl mx-auto text-center ${BRAND.subtle}`}>Loading tickets…</div>
        )}

        {!loading && error && (
          <div className="max-w-7xl mx-auto text-center">
            <div className="text-red-600 font-semibold">Could not load tickets</div>
            <div className={`text-sm mt-1 ${BRAND.subtle}`}>{error}</div>
            <button onClick={() => window.location.reload()} className={`mt-4 ${BRAND.btnPrimarySm}`}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && allTickets.length === 0 && (
          <div className={`max-w-7xl mx-auto text-center ${BRAND.subtle}`}>
            No tickets available right now.
            <div className="text-sm text-gray-500 mt-1">
              (Tip: run <span className="font-mono">POST /api/debug/seed?fresh=1</span>)
            </div>
          </div>
        )}

        {!loading && !error && allTickets.length > 0 && (
          <div className="max-w-7xl mx-auto">
            {/* Carousel Container */}
            <div className="relative flex items-center gap-4">
              {/* Left Arrow */}
              <button
                onClick={handlePrev}
                disabled={!canGoPrev}
                className={`flex-shrink-0 w-12 h-12 rounded-full bg-white dark:bg-white/10 shadow-lg border border-[var(--border)] flex items-center justify-center transition ${
                  canGoPrev
                    ? "hover:bg-gray-50 dark:hover:bg-white/20 text-[var(--tft-navy)] dark:text-white"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                }`}
                aria-label="Previous tickets"
              >
                <ChevronLeftIcon className="w-6 h-6" />
              </button>

              {/* Tickets Grid */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {displayedTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="bg-white/95 dark:bg-white/5 rounded-xl shadow-lg hover:shadow-2xl transition transform hover:-translate-y-2 flex flex-col border border-[var(--border)]"
                  >
                    <div className="relative">
                      <img
                        src={`${ticket.dynamicImage || ticket.placeholderImage || DEFAULT_IMAGE}?v=2`}
                        alt={ticket.title}
                        className="rounded-t-xl object-cover w-full h-48"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          img.onerror = null;
                          img.src = ticket.placeholderImage || DEFAULT_IMAGE;
                        }}
                      />

                      {/* Badges */}
                      <div className="absolute top-2 left-2 flex flex-col gap-1">
                        {ticket.isSoldOut && (
                          <span className="bg-amber-500 text-white px-2 py-1 text-xs font-semibold rounded">
                            ⭐ Sold Out
                          </span>
                        )}
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded ${
                            ticket.priceTag === "Face Value"
                              ? "bg-green-100 text-green-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {ticket.priceTag}
                        </span>
                      </div>
                      {/* Event Type */}
                      <span className="absolute top-2 right-2 px-2 py-1 text-xs font-semibold rounded bg-gray-800 text-white">
                        {ticket.eventTypeLabel}
                      </span>
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
                      
                      {/* Row and Seat Display */}
                      {(ticket.row || ticket.seat) && (
                        <p className="text-sm font-medium text-[var(--tft-navy)] dark:text-[var(--tft-teal)] mb-2">
                          {ticket.row && `Row ${ticket.row}`}
                          {ticket.row && ticket.seat && " • "}
                          {ticket.seat && `Seat ${ticket.seat}`}
                        </p>
                      )}

                      <div className="flex items-center mb-3">
                        <div className="flex text-yellow-400 mr-2">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span key={i}>{i < Math.round(ticket.rating) ? "★" : "☆"}</span>
                          ))}
                        </div>
                        <span className={`text-sm ${BRAND.subtle}`}>({ticket.reviews})</span>
                      </div>

                      <p className="font-semibold text-[var(--tft-navy)] mb-4">${ticket.price.toFixed(2)}</p>

                      <div className="mt-auto flex gap-2">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="flex-1 text-center button-primary py-2 rounded transition shadow-sm hover:shadow"
                        >
                          View Ticket
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Right Arrow */}
              <button
                onClick={handleNext}
                disabled={!canGoNext}
                className={`flex-shrink-0 w-12 h-12 rounded-full bg-white dark:bg-white/10 shadow-lg border border-[var(--border)] flex items-center justify-center transition ${
                  canGoNext
                    ? "hover:bg-gray-50 dark:hover:bg-white/20 text-[var(--tft-navy)] dark:text-white"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                }`}
                aria-label="Next tickets"
              >
                <ChevronRightIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Pagination indicator */}
            <div className="text-center mt-4 text-sm text-gray-500">
              Showing {currentIndex + 1}-{Math.min(currentIndex + TICKETS_PER_PAGE, allTickets.length)} of {allTickets.length} tickets
            </div>
          </div>
        )}
      </section>

      {/* Community Forum Preview */}
      <section className="px-6 sm:px-8 pb-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h2 className={`text-3xl font-bold ${BRAND.title}`}>Community Forum</h2>
              <p className={`${BRAND.subtle} mt-1`}>
                Latest discussions (showing up to 6). Jump in or browse more.
              </p>
            </div>

            <Link
              href="/forum"
              className={`shrink-0 ${BRAND.btnPrimarySm} inline-flex items-center justify-center`}
            >
              View all discussions
            </Link>
          </div>

          <div className="bg-white/95 dark:bg-white/5 rounded-xl shadow-lg border border-[var(--border)]">
            {forumLoading ? (
              <div className={`p-6 ${BRAND.subtle}`}>Loading latest discussions…</div>
            ) : forumThreads.length === 0 ? (
              <div className="p-6">
                <div className="text-[var(--foreground)] font-semibold">No discussions yet</div>
                <div className={`${BRAND.subtle} text-sm mt-1`}>
                  Once threads are created, the newest ones will appear here automatically.
                </div>
                <div className="mt-4">
                  <Link href="/forum" className={`inline-block ${BRAND.btnOutline}`}>
                    Go to forum
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {forumThreads.slice(0, 6).map((t) => (
                  <li key={t.id} className="p-5 hover:bg-black/5 dark:hover:bg-white/5 transition">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded-full ${BRAND.pillBrand}`}
                          >
                            {topicTypeLabel(t.topicType)}
                          </span>

                          {t.topic ? (
                            <span
                              className={`text-xs font-semibold px-2 py-1 rounded-full ${BRAND.pillNeutral}`}
                            >
                              {t.topic}
                            </span>
                          ) : null}

                          <Link
                            href={`/forum/threads/${t.id}`}
                            className="font-semibold text-[var(--foreground)] hover:text-[var(--tft-teal)] truncate"
                            title={t.title}
                          >
                            {t.title}
                          </Link>
                        </div>

                        <div className="text-xs text-gray-500 mt-1">
                          {t.updatedAt ? `Updated ${formatForumTime(t.updatedAt)}` : ""}
                        </div>
                      </div>

                      <div className={`shrink-0 text-sm ${BRAND.subtle}`}>
                        <span className="px-2 py-1 rounded bg-gray-100 dark:bg-white/10">
                          {t.replies} repl{t.replies === 1 ? "y" : "ies"}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="p-4 border-t border-[var(--border)] bg-gray-50/80 dark:bg-white/5 flex items-center justify-between">
              <span className={`text-sm ${BRAND.subtle}`}>Showing the newest topics</span>
              <Link href="/forum" className={`text-sm font-semibold ${BRAND.link}`}>
                More →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
