import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/seo";
import { isTicketEventExpired } from "@/lib/tickets/expiry";

export const dynamic = "force-dynamic";

const staticPages: Array<[string, number, MetadataRoute.Sitemap[number]["changeFrequency"]]> = [
  ["", 1, "daily"],
  ["/tickets", 0.9, "hourly"],
  ["/about/how-it-works", 0.8, "monthly"],
  ["/about/why-face-value", 0.8, "monthly"],
  ["/about/trust-and-safety", 0.8, "monthly"],
  ["/about/our-story", 0.7, "monthly"],
  ["/faq", 0.7, "monthly"],
  ["/faq/buying", 0.7, "monthly"],
  ["/faq/selling", 0.7, "monthly"],
  ["/faq/payments", 0.6, "monthly"],
  ["/faq/refunds", 0.6, "monthly"],
  ["/faq/access-tokens", 0.6, "monthly"],
  ["/pricing-policy", 0.7, "monthly"],
  ["/forum", 0.5, "daily"],
  ["/community-guidelines", 0.4, "yearly"],
  ["/accessibility", 0.3, "yearly"],
  ["/privacy", 0.3, "yearly"],
  ["/terms", 0.3, "yearly"],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = staticPages.map(([path, priority, changeFrequency]) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  }));

  try {
    const tickets = await prisma.ticket.findMany({
      where: { status: "AVAILABLE" },
      select: { id: true, date: true, venue: true, eventId: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    const active = tickets.filter((ticket) => !isTicketEventExpired({ date: ticket.date, venue: ticket.venue }));

    pages.push(...active.map((ticket) => ({
      url: `${SITE_URL}/tickets/${ticket.id}`,
      lastModified: ticket.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })));

    const eventIds = Array.from(new Set(active.map((ticket) => ticket.eventId).filter((id): id is string => Boolean(id))));
    if (eventIds.length) {
      const events = await prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, updatedAt: true },
      });
      pages.push(...events.map((event) => ({
        url: `${SITE_URL}/events/${event.id}`,
        lastModified: event.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.85,
      })));
    }
  } catch (error) {
    console.error("Unable to add live inventory to sitemap", error);
  }

  return pages;
}
