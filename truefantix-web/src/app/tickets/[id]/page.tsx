import Link from "next/link";
import Footer from "@/components/Footer";
import TicketImage from "@/components/TicketImage";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getTicketImage, getPlaceholderImage } from "@/lib/imageSearch";

interface TicketPageProps {
  params: Promise<{ id: string }>;
}

async function getTicket(id: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      seller: {
        include: { badges: true }
      },
      event: true,
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
      badges: ticket.seller.badges.map(b => ({
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
    faceValueCents: ticket.faceValueCents ? Number(ticket.faceValueCents) : null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
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

export default async function TicketDetailPage({ params }: TicketPageProps) {
  const { id } = await params;
  const ticket = await getTicket(id);

  if (!ticket || ticket.status !== "AVAILABLE") {
    notFound();
  }

  const seller = ticket.seller;
  const event = ticket.event;

  // Calculate price display
  const price = ticket.priceCents / 100;
  const faceValue = ticket.faceValueCents ? ticket.faceValueCents / 100 : price;
  const isBelowFaceValue = faceValue && price < faceValue;
  const isFaceValue = faceValue && price === faceValue;
  const isSoldOut = event?.selloutStatus === "SOLD_OUT";

  // Get event type info
  const eventTypeInfo = getEventTypeInfo(ticket.title);
  
  // Fetch dynamic image
  const dynamicImage = await getTicketImage(ticket.title, eventTypeInfo.type);
  const imageToShow = dynamicImage.startsWith("http") ? dynamicImage : getPlaceholderImage(eventTypeInfo.type);

  // Parse venue for location info
  const venueParts = ticket.venue.split(",").map(p => p.trim());
  const city = venueParts[1] || "Toronto";
  const province = "ON";
  const country = "Canada";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Hero */}
      <section className="bg-[var(--tft-navy)] text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">{ticket.title}</h1>
          <p className="text-xl text-gray-300">{ticket.venue}</p>
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
                    ⭐ Exclusive: Sold Out Event
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
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Date:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{ticket.date}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Venue:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{ticket.venue}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Location:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{city}, {province}, {country}</span>
                    </div>
                    {(ticket.row || ticket.seat) && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Seat:</span>
                        <span className="font-medium text-gray-900 dark:text-white">
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
                      <span className="font-bold text-2xl text-[var(--tft-navy)] dark:text-[var(--tft-teal)]">${price.toFixed(2)}</span>
                    </div>
                    {faceValue > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Face Value:</span>
                        <span className="font-medium text-gray-900 dark:text-white">${faceValue.toFixed(2)}</span>
                      </div>
                    )}
                    {isBelowFaceValue && faceValue > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>You Save:</span>
                        <span className="font-bold">${(faceValue - price).toFixed(2)}</span>
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
                        {seller.badges.map((badge: any) => (
                          <span key={badge.id || badge.name || String(Math.random())} className="bg-[rgba(6,74,147,0.10)] text-[var(--tft-navy)] px-2 py-1 rounded-full text-sm">
                            {badge.name || badge}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Purchase Section */}
                  <div className="mt-8">
                    <button className="w-full bg-[var(--tft-navy)] text-white py-4 rounded-lg font-bold text-lg hover:bg-[var(--tft-navy-dark)] transition">
                      Buy Ticket - ${price.toFixed(2)}
                    </button>
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
