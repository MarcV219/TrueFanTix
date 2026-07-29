import Link from "next/link";
import Footer from "@/components/Footer";
import TicketImage from "@/components/TicketImage";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getTicketImage, getPlaceholderImage } from "@/lib/imageSearch";
import { isTicketEventExpired } from "@/lib/tickets/expiry";
import { formatMoney, normalizeCurrency, venueInfoFromLocation } from "@/lib/ticketsView";
import { searchProviderCatalog } from "@/lib/catalog/provider-catalog";
import PurchaseButton from "./PurchaseButton";

interface TicketPageProps {
  params: Promise<{ id: string }>;
}

async function getTicket(id: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      priceCents: true,
      currency: true,
      faceValueCents: true,
      adminFeePaidCents: true,
      verificationEvidence: true,
      image: true,
      venue: true,
      section: true,
      row: true,
      seat: true,
      date: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      sellerId: true,
      seller: {
        select: {
          id: true,
          name: true,
          rating: true,
          reviews: true,
          badges: {
            select: {
              id: true,
              name: true,
              sellerId: true,
            },
          },
        },
      },
      event: {
        select: {
          id: true,
          title: true,
          venue: true,
          date: true,
          selloutStatus: true,
        },
      },
    },
  });
  
  // Serialize to plain object to avoid BigInt issues
  if (!ticket) return null;
  
  return {
    ...ticket,
    id: String(ticket.id),
    sellerId: String(ticket.sellerId),
    seller: ticket.seller ? {
      ...ticket.seller,
      id: String(ticket.seller.id),
      badges: ticket.seller.badges.map((b: any) => ({
        ...b,
        id: String(b.id),
        sellerId: String(b.sellerId)
      }))
    } : null,
    event: ticket.event ? {
      ...ticket.event,
      id: String(ticket.event.id)
    } : null,
    priceCents: Number(ticket.priceCents),
    currency: normalizeCurrency((ticket as any).currency),
    faceValueCents: ticket.faceValueCents ? Number(ticket.faceValueCents) : null,
    adminFeePaidCents: Number(ticket.adminFeePaidCents ?? 0),
    verificationEvidence: ticket.verificationEvidence ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

function parseJson(value: string | null | undefined): any {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getEventTypeInfo(title: string) {
  const lower = title.toLowerCase();
  
  if (lower.match(/raptors|basketball/)) return { type: "sports-basketball", label: "Sports: Basketball", class: "bg-orange-100 text-orange-800" };
  if (lower.match(/leafs|hockey/)) return { type: "sports-hockey", label: "Sports: Hockey", class: "bg-blue-100 text-blue-800" };
  if (lower.match(/blue jays|baseball/)) return { type: "sports-baseball", label: "Sports: Baseball", class: "bg-red-100 text-red-800" };
  if (lower.includes("football") && !lower.includes("hockey")) return { type: "sports-football", label: "Sports: Football", class: "bg-brown-100 text-brown-800" };
  if (lower.includes("soccer")) return { type: "sports-soccer", label: "Sports: Soccer", class: "bg-green-100 text-green-800" };
  if (lower.includes("lacrosse")) return { type: "sports-lacrosse", label: "Sports: Lacrosse", class: "bg-purple-100 text-purple-800" };
  if (lower.match(/argos|argonauts/)) return { type: "sports-football", label: "Sports: Football", class: "bg-brown-100 text-brown-800" };
  if (lower.match(/tfc|toronto fc/)) return { type: "sports-soccer", label: "Sports: Soccer", class: "bg-green-100 text-green-800" };
  if (lower.match(/sports|vs\.|game/)) return { type: "sports-other", label: "Sports: Other", class: "bg-blue-100 text-blue-800" };
  if (lower.match(/comedy|stand.up/)) return { type: "comedy", label: "Comedy", class: "bg-yellow-100 text-yellow-800" };
  if (lower.match(/concert|taylor|drake|sheeran|weeknd|adele|beyonce/)) return { type: "concert", label: "Concert", class: "bg-pink-100 text-pink-800" };
  if (lower.includes("conference")) return { type: "conference", label: "Conference", class: "bg-indigo-100 text-indigo-800" };
  if (lower.includes("festival")) return { type: "festival", label: "Festival", class: "bg-green-100 text-green-800" };
  if (lower.includes("gala")) return { type: "gala", label: "Gala", class: "bg-purple-100 text-purple-800" };
  if (lower.includes("opera")) return { type: "opera", label: "Opera", class: "bg-red-100 text-red-800" };
  if (lower.match(/theatre|theater|hamilton/)) return { type: "theatre", label: "Theatre", class: "bg-amber-100 text-amber-800" };
  if (lower.includes("workshop")) return { type: "workshop", label: "Workshop", class: "bg-teal-100 text-teal-800" };
  
  return { type: "other", label: "Other", class: "bg-gray-100 text-gray-800" };
}

function getEventTypeInfoFromType(type: string | null | undefined, fallbackTitle: string) {
  const normalized = String(type || "").trim().toLowerCase();
  const map: Record<string, { type: string; label: string; class: string }> = {
    "sports-basketball": { type: "sports-basketball", label: "Sports: Basketball", class: "bg-orange-100 text-orange-800" },
    "sports-hockey": { type: "sports-hockey", label: "Sports: Hockey", class: "bg-blue-100 text-blue-800" },
    "sports-baseball": { type: "sports-baseball", label: "Sports: Baseball", class: "bg-red-100 text-red-800" },
    "sports-football": { type: "sports-football", label: "Sports: Football", class: "bg-brown-100 text-brown-800" },
    "sports-soccer": { type: "sports-soccer", label: "Sports: Soccer", class: "bg-green-100 text-green-800" },
    "sports-lacrosse": { type: "sports-lacrosse", label: "Sports: Lacrosse", class: "bg-purple-100 text-purple-800" },
    "sports-other": { type: "sports-other", label: "Sports: Other", class: "bg-blue-100 text-blue-800" },
    concert: { type: "concert", label: "Concert", class: "bg-pink-100 text-pink-800" },
    theatre: { type: "theatre", label: "Theatre", class: "bg-amber-100 text-amber-800" },
    comedy: { type: "comedy", label: "Comedy", class: "bg-yellow-100 text-yellow-800" },
    conference: { type: "conference", label: "Conference", class: "bg-indigo-100 text-indigo-800" },
    festival: { type: "festival", label: "Festival", class: "bg-green-100 text-green-800" },
    gala: { type: "gala", label: "Gala", class: "bg-purple-100 text-purple-800" },
    opera: { type: "opera", label: "Opera", class: "bg-red-100 text-red-800" },
    workshop: { type: "workshop", label: "Workshop", class: "bg-teal-100 text-teal-800" },
    other: { type: "other", label: "Other", class: "bg-gray-100 text-gray-800" },
  };
  return map[normalized] ?? getEventTypeInfo(fallbackTitle);
}

function normalizeVenueCountry(country: string | null | undefined) {
  const upper = String(country || "").trim().toUpperCase();
  if (upper === "CA" || upper === "CAN") return "Canada";
  if (upper === "US" || upper === "USA") return "USA";
  return String(country || "").trim();
}

async function resolveVenueLocation(venue: string) {
  const suggestions = await searchProviderCatalog({
    query: venue,
    type: "VENUE",
    limit: 10,
    includeProviders: false,
  });

  const key = venue.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const exact = suggestions.find((suggestion) =>
    String(suggestion.canonicalName || suggestion.label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() === key
  );
  const best = exact ?? suggestions[0];
  if (!best) return null;

  return {
    address: best.address ?? null,
    city: best.city ?? null,
    region: best.region ?? null,
    country: normalizeVenueCountry(best.country),
  };
}

function eventTitleWithVenue(title: string, venue: string) {
  const t = title.trim();
  const v = venue.trim();
  if (!v || t.toLowerCase().includes(v.toLowerCase())) return t;
  return `${t} at ${v}`;
}

export default async function TicketDetailPage({ params }: TicketPageProps) {
  const { id } = await params;
  const ticket = await getTicket(id);

  if (!ticket || ticket.status !== "AVAILABLE" || isTicketEventExpired({ date: ticket.date, venue: ticket.venue })) {
    notFound();
  }

  const seller = ticket.seller;
  const event = ticket.event;

  // Calculate price display
  const price = ticket.priceCents / 100;
  const currency = normalizeCurrency((ticket as any).currency);
  const faceValue = ticket.faceValueCents ? ticket.faceValueCents / 100 : price;
  const adminFeePaid = ticket.adminFeePaidCents / 100;
  const maxFairListPrice = faceValue + adminFeePaid;
  const evidence = parseJson(ticket.verificationEvidence);
  const officialOriginalFairValueCents =
    typeof evidence?.officialPricingSync?.officialFaceValueCents === "number"
      ? evidence.officialPricingSync.officialFaceValueCents
      : null;
  const officialOriginalFairValue =
    officialOriginalFairValueCents == null ? null : officialOriginalFairValueCents / 100;
  const sellerMarkupPaid =
    officialOriginalFairValueCents != null && ticket.faceValueCents != null
      ? Math.max(0, ticket.faceValueCents - officialOriginalFairValueCents) / 100
      : null;
  const sellerTotalPaid = faceValue + adminFeePaid;
  const isBelowFaceValue = maxFairListPrice && price < maxFairListPrice;
  const isFaceValue = maxFairListPrice && price === maxFairListPrice;
  const isSoldOut = event?.selloutStatus === "SOLD_OUT";
  const eventTitle = event?.title || ticket.title;
  const eventVenue = event?.venue || ticket.venue;
  const eventDisplayTitle = eventTitleWithVenue(eventTitle, eventVenue);
  const venueLocation = await resolveVenueLocation(eventVenue);
  const venueInfo = venueInfoFromLocation(eventVenue, venueLocation);
  const locationDisplay = [venueInfo.address, venueInfo.city, venueInfo.province, venueInfo.country].filter(Boolean).join(", ");

  // Get seller-selected event category from listing evidence, matching card behavior.
  const eventTypeInfo = getEventTypeInfoFromType(evidence?.manualEventType ?? evidence?.inferredEventType, ticket.title);
  
  // Fetch dynamic image
  const dynamicImage = await getTicketImage(ticket.title, eventTypeInfo.type);
  const imageToShow = dynamicImage.startsWith("http") ? dynamicImage : getPlaceholderImage(eventTypeInfo.type);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">{eventDisplayTitle}</h1>
          <p className="text-xl text-gray-300">{eventVenue}</p>
        </div>
      </section>

      {/* Ticket Details */}
      <section className="py-8 px-4 flex-1">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Ticket Image */}
            <div className="relative h-64 bg-gray-200 dark:bg-gray-700">
              <TicketImage
                src={imageToShow}
                alt={ticket.title}
                fallbackSrc={getPlaceholderImage(eventTypeInfo.type)}
              />
              {/* Badges */}
              <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                {isSoldOut && (
                  <span className="bg-amber-500 text-white px-3 py-1 rounded-full font-semibold text-sm">
                    Box office sold out • Resale tickets available
                  </span>
                )}
                {isBelowFaceValue && (
                  <span className="bg-blue-500 text-white px-3 py-1 rounded-full font-semibold text-sm">
                    Below Face Value
                  </span>
                )}
                {isFaceValue && (
                  <span className="bg-green-500 text-white px-3 py-1 rounded-full font-semibold text-sm">
                    Face Value
                  </span>
                )}
              </div>
              <div className="absolute top-4 right-4">
                <span className={`${eventTypeInfo.class} px-3 py-1 rounded-full font-semibold text-sm`}>
                  {eventTypeInfo.label}
                </span>
              </div>
            </div>

            {/* Ticket Info */}
            <div className="p-8">
              <div className="grid md:grid-cols-2 gap-8">
                {/* Left Column */}
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                    Event Details
                  </h2>
                  <div className="space-y-3">
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600 dark:text-gray-400">Event:</span>
                      <span className="font-medium text-gray-900 dark:text-white text-right">{eventDisplayTitle}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600 dark:text-gray-400">Date:</span>
                      <span className="font-medium text-gray-900 dark:text-white text-right">{ticket.date}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600 dark:text-gray-400">Venue:</span>
                      <span className="font-medium text-gray-900 dark:text-white text-right">{eventVenue}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600 dark:text-gray-400">Location:</span>
                      <span className="font-medium text-gray-900 dark:text-white text-right">{locationDisplay || "Venue location unavailable"}</span>
                    </div>
                    {(ticket.section || ticket.row || ticket.seat) && (
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-600 dark:text-gray-400">Seat:</span>
                        <span className="font-medium text-gray-900 dark:text-white text-right">
                          {ticket.section && `Section ${ticket.section}`}
                          {ticket.section && (ticket.row || ticket.seat) && " • "}
                          {ticket.row && `Row ${ticket.row}`}
                          {ticket.row && ticket.seat && " • "}
                          {ticket.seat && `Seat ${ticket.seat}`}
                        </span>
                      </div>
                    )}
                  </div>

                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-4">
                    Pricing
                  </h2>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Price:</span>
                      <span className="font-bold text-2xl text-[var(--tft-navy)] dark:text-[var(--tft-teal)]">{formatMoney(price, currency)} {currency}</span>
                    </div>
                    {faceValue > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Seller Face Value Paid:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{formatMoney(faceValue, currency)} {currency}</span>
                      </div>
                    )}
                    {officialOriginalFairValue != null && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Original Fair Value:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{formatMoney(officialOriginalFairValue, currency)} {currency}</span>
                      </div>
                    )}
                    {sellerMarkupPaid != null && sellerMarkupPaid > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Markup Seller Paid:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{formatMoney(sellerMarkupPaid, currency)} {currency}</span>
                      </div>
                    )}
                    {adminFeePaid > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Seller Fees Paid:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{formatMoney(adminFeePaid, currency)} {currency}</span>
                      </div>
                    )}
                    {sellerTotalPaid > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Seller Total Paid:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{formatMoney(sellerTotalPaid, currency)} {currency}</span>
                      </div>
                    )}
                    {adminFeePaid > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Max Allowed List Price:</span>
                        <span className="font-medium text-gray-900 dark:text-white">{formatMoney(maxFairListPrice, currency)} {currency}</span>
                      </div>
                    )}
                    {isBelowFaceValue && maxFairListPrice > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>You Save:</span>
                        <span className="font-bold">{formatMoney(maxFairListPrice - price, currency)} {currency}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column - Seller Info */}
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                    Seller Information
                  </h2>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-[var(--tft-navy)] rounded-full flex items-center justify-center text-white text-xl">
                        {seller?.name?.charAt(0) || "S"}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{seller?.name || "Unknown Seller"}</p>
                        <div className="flex items-center text-yellow-400">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span key={i}>{i < Math.round(seller?.rating || 0) ? "★" : "☆"}</span>
                          ))}
                          <span className="text-gray-600 dark:text-gray-400 ml-2 text-sm">({seller?.reviews || 0} reviews)</span>
                        </div>
                      </div>
                    </div>
                    {seller?.badges && seller.badges.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {seller.badges.map((badge: any, index: number) => {
                          const badgeLabel = typeof badge === "string" ? badge : badge.name || "Badge";
                          return (
                            <span key={badge.id || `${badgeLabel}-${index}`} className="bg-[rgba(6,74,147,0.10)] text-[var(--tft-navy)] px-2 py-1 rounded-full text-sm">
                              {badgeLabel}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Purchase Section */}
                  <div className="mt-8">
                    <PurchaseButton ticketId={ticket.id} price={`${formatMoney(price, currency)} ${currency}`} />
                    <p className="text-sm text-gray-500 mt-2 text-center">
                      + 8.75% admin fee + applicable taxes
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Back Button */}
          <div className="mt-8 flex justify-between">
            <Link
              href="/tickets"
              className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition"
            >
              ← Back to Tickets
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
