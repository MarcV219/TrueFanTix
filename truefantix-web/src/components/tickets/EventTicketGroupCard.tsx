"use client";

import React from "react";
import Link from "next/link";

import { formatMoney } from "@/lib/ticketsView";
import type { TicketCardView } from "@/lib/ticketsView";

const DEFAULT_IMAGE = "/default.jpg";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function sectionLabel(ticket: TicketCardView) {
  return ticket.section?.trim() || (ticket.row?.toLowerCase().includes("general admission") ? "General Admission" : "Section not specified");
}

function priceSummary(tickets: TicketCardView[]) {
  const byCurrency = new Map<string, number[]>();
  for (const ticket of tickets) {
    const prices = byCurrency.get(ticket.currency) ?? [];
    prices.push(ticket.price);
    byCurrency.set(ticket.currency, prices);
  }

  return Array.from(byCurrency, ([currency, prices]) => {
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return low === high
      ? `From ${formatMoney(low, currency)} ${currency}`
      : `${formatMoney(low, currency)}–${formatMoney(high, currency)} ${currency}`;
  }).join(" • ");
}

export default function EventTicketGroupCard<T extends TicketCardView>({
  tickets,
  selectedTicketIds = [],
  onToggleTicket,
  onViewTicket,
  reasons = [],
}: {
  tickets: T[];
  selectedTicketIds?: string[];
  onToggleTicket?: (ticket: T) => void;
  onViewTicket?: () => void;
  reasons?: string[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const lead = tickets[0];
  if (!lead) return null;

  const venueLocation = [lead.venueAddress, lead.city, lead.province, lead.country].filter(Boolean).join(", ");
  const sectionCounts = Array.from(
    tickets.reduce((counts, ticket) => {
      const section = sectionLabel(ticket);
      counts.set(section, (counts.get(section) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);
  const selectedCount = tickets.filter((ticket) => selectedTicketIds.includes(ticket.id)).length;
  const image = String(lead.dynamicImage || lead.image || lead.placeholderImage || DEFAULT_IMAGE);
  const imageSrc = image.startsWith("http://") || image.startsWith("https://") ? image : `${image}?v=2`;

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg transition hover:shadow-xl dark:border-gray-700 dark:bg-gray-800">
      {lead.isSoldOut ? (
        <div className="border-b border-amber-700 bg-amber-500 px-3 py-2 text-center text-sm font-extrabold tracking-wide text-white shadow-sm">
          Box office sold out <span aria-hidden="true">•</span> Resale tickets available
        </div>
      ) : null}

      <div className="relative">
        <img
          src={imageSrc}
          alt={lead.title}
          className="h-48 w-full object-cover"
          onError={(event) => {
            (event.target as HTMLImageElement).src = lead.placeholderImage || DEFAULT_IMAGE;
          }}
        />
        <span className="absolute right-2 top-2 rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-white">
          {lead.eventTypeLabel}
        </span>
      </div>

      <div className="p-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{lead.title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">{lead.date}</p>
        <p className="text-sm text-gray-500">{lead.venue}</p>
        {venueLocation ? <p className="text-xs text-gray-500">{venueLocation}</p> : null}

        <div className="my-4 rounded-lg bg-blue-50 p-3 ring-1 ring-blue-100 dark:bg-blue-950/40 dark:ring-blue-900">
          <p className="font-extrabold text-[#064a93] dark:text-blue-300">
            {tickets.length} {plural(tickets.length, "ticket")} available <span aria-hidden="true">•</span>{" "}
            {tickets.length} {plural(tickets.length, "listing")}
          </p>
          <p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{priceSummary(tickets)}</p>
          <div className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {sectionCounts.slice(0, 3).map(([section, count]) => (
              <p key={section}>
                {section}: {count} {plural(count, "ticket")}
              </p>
            ))}
            {sectionCounts.length > 3 ? <p>+ {sectionCounts.length - 3} more sections</p> : null}
          </div>
        </div>

        {reasons.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {Array.from(new Set(reasons)).slice(0, 2).map((reason) => (
              <span key={reason} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#064a93] ring-1 ring-blue-100 dark:bg-white/10 dark:text-white dark:ring-white/15">
                {reason}
              </span>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full rounded-lg bg-[#064a93] px-4 py-2.5 font-bold text-white transition hover:bg-blue-900"
          aria-expanded={expanded}
        >
          {expanded ? "Hide listings" : `Choose tickets (${tickets.length})`}
        </button>

        {selectedCount ? (
          <p className="mt-2 text-center text-sm font-bold text-[#064a93] dark:text-blue-300">
            {selectedCount} selected from this event
          </p>
        ) : null}

        {expanded ? (
          <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <p className="text-sm font-bold text-gray-900 dark:text-white">Listings, lowest price first</p>
            {tickets.map((ticket) => {
              const selected = selectedTicketIds.includes(ticket.id);
              const seatDetails = [
                ticket.section ? `Section ${ticket.section}` : null,
                ticket.row ? `Row ${ticket.row}` : null,
                ticket.seat ? `Seat ${ticket.seat}` : null,
              ].filter(Boolean).join(" • ") || "Seat details not specified";

              return (
                <div key={ticket.id} className={`rounded-lg border p-3 ${selected ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40" : "border-gray-200 dark:border-gray-700"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{seatDetails}</p>
                      <p className="text-xs text-gray-500">{ticket.priceTag}</p>
                    </div>
                    <p className="shrink-0 font-extrabold text-gray-900 dark:text-white">
                      {formatMoney(ticket.price, ticket.currency)} {ticket.currency}
                    </p>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {onToggleTicket ? (
                      <button
                        type="button"
                        onClick={() => onToggleTicket(ticket)}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-bold transition ${
                          selected
                            ? "border-[#064a93] bg-[#064a93] text-white"
                            : "border-gray-300 text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
                        }`}
                      >
                        {selected ? "Selected" : "Select"}
                      </button>
                    ) : null}
                    <Link
                      href={`/tickets/${ticket.id}`}
                      onClick={onViewTicket}
                      className="flex-1 rounded-md border border-[#064a93] px-3 py-2 text-center text-sm font-bold text-[#064a93] hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                    >
                      View details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
