import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import { prisma } from "@/lib/prisma";
import { isTicketEventExpired } from "@/lib/tickets/expiry";
import { formatMoney, normalizeCurrency } from "@/lib/ticketsView";
import { absoluteUrl, conciseDescription, DEFAULT_SOCIAL_IMAGE, safeJsonLd, schemaDate } from "@/lib/seo";

interface EventPageProps {
  params: Promise<{ id: string }>;
}

async function getEvent(id: string) {
  return prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      venue: true,
      date: true,
      updatedAt: true,
      tickets: {
        where: { status: "AVAILABLE" },
        orderBy: [{ priceCents: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          venue: true,
          date: true,
          image: true,
          priceCents: true,
          currency: true,
          section: true,
          row: true,
          seat: true,
        },
      },
    },
  });
}

function activeTickets<T extends { date: string; venue: string }>(tickets: T[]) {
  return tickets.filter((ticket) => !isTicketEventExpired({ date: ticket.date, venue: ticket.venue }));
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) return { title: "Event not found", robots: { index: false, follow: false } };

  const listings = activeTickets(event.tickets);
  const venue = event.venue || listings[0]?.venue || "the event venue";
  const title = `${event.title} Tickets at ${venue}`;
  const description = conciseDescription(
    listings.length
      ? `Compare ${listings.length} verified ${event.title} ticket ${listings.length === 1 ? "listing" : "listings"} at or below face value on TrueFanTix.`
      : `Find verified ${event.title} tickets at or below face value on TrueFanTix. Check current availability and event details.`,
  );
  const image = listings.find((ticket) => ticket.image?.startsWith("http"))?.image || DEFAULT_SOCIAL_IMAGE;
  const canonical = `/events/${event.id}`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: listings.length ? undefined : { index: false, follow: true },
    openGraph: { type: "website", url: canonical, title: `${title} | TrueFanTix`, description, images: [{ url: image, alt: event.title }] },
    twitter: { card: "summary_large_image", title: `${title} | TrueFanTix`, description, images: [image] },
  };
}

export default async function EventPage({ params }: EventPageProps) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  const listings = activeTickets(event.tickets);
  const venue = event.venue || listings[0]?.venue || "Venue to be confirmed";
  const date = event.date || listings[0]?.date || "Date to be confirmed";
  const eventUrl = absoluteUrl(`/events/${event.id}`);
  const eventJsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: schemaDate(date),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: eventUrl,
    image: listings[0]?.image ? [listings[0].image.startsWith("http") ? listings[0].image : absoluteUrl(listings[0].image)] : [absoluteUrl(DEFAULT_SOCIAL_IMAGE)],
    location: { "@type": "Place", name: venue },
    ...(listings.length
      ? {
          offers: listings.map((ticket) => ({
            "@type": "Offer",
            url: absoluteUrl(`/tickets/${ticket.id}`),
            price: (ticket.priceCents / 100).toFixed(2),
            priceCurrency: normalizeCurrency(ticket.currency),
            availability: "https://schema.org/InStock",
          })),
        }
      : {}),
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(eventJsonLd) }} />
      <main className="flex-1">
        <section className="bg-[var(--tft-navy)] text-white py-12">
          <div className="max-w-5xl mx-auto px-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--tft-teal)] mb-2">Verified event tickets</p>
            <h1 className="text-4xl font-bold mb-3">{event.title}</h1>
            <p className="text-lg text-gray-200">{venue} · {date}</p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 py-10">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Tickets at or below verified face value</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">TrueFanTix verifies listings and prevents sellers from pricing above what they paid, including eligible original ticket fees.</p>
          </div>

          {listings.length ? (
            <div className="grid gap-5 md:grid-cols-2">
              {listings.map((ticket) => {
                const currency = normalizeCurrency(ticket.currency);
                const seat = [ticket.section && `Section ${ticket.section}`, ticket.row && `Row ${ticket.row}`, ticket.seat && `Seat ${ticket.seat}`].filter(Boolean).join(" · ");
                return (
                  <article key={ticket.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">{ticket.title}</h3>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">{seat || "General admission or seat details on listing"}</p>
                    <p className="mt-4 text-2xl font-bold text-[var(--tft-navy)] dark:text-[var(--tft-teal)]">{formatMoney(ticket.priceCents / 100, currency)} {currency}</p>
                    <Link href={`/tickets/${ticket.id}`} className="button-primary mt-5 inline-block rounded-lg px-5 py-3 font-semibold">View verified listing</Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">No tickets are currently available</h2>
              <p className="mt-2 text-gray-600 dark:text-gray-300">Browse other events or check again when fans add new verified listings.</p>
              <Link href="/tickets" className="button-primary mt-5 inline-block rounded-lg px-5 py-3 font-semibold">Browse all tickets</Link>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
