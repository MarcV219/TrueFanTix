import Link from "next/link";

import type { TicketCardView } from "@/lib/ticketsView";

const DEFAULT_IMAGE = "/default.jpg";

export default function TicketCard({ ticket }: { ticket: TicketCardView }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition flex flex-col border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="relative">
        <img
          src={(() => {
            const raw = String(ticket.dynamicImage || ticket.image || ticket.placeholderImage || DEFAULT_IMAGE);
            if (raw.startsWith("http://") || raw.startsWith("https://")) {
              return raw;
            }
            return `${raw}?v=2`;
          })()}
          alt={ticket.title}
          className="w-full h-48 object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = ticket.placeholderImage || DEFAULT_IMAGE;
          }}
        />
        {(ticket.isAboveConfirmedFaceValue || ticket.isValidationMismatch) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-red-600 text-8xl font-extrabold opacity-70 leading-none">✕</span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {ticket.isSoldOut && (
            <span className="bg-amber-500 text-white px-2 py-1 text-xs font-semibold rounded">
              ⭐ Sold Out Event
            </span>
          )}
          <span
            className={`px-2 py-1 text-xs font-semibold rounded ${
              ticket.priceTag === "Face Value" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"
            }`}
          >
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
          <Link href={`/tickets/${ticket.id}`} className="flex-1 text-center bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition">
            View Ticket
          </Link>
        </div>
      </div>
    </div>
  );
}
