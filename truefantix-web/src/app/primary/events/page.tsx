import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePrimaryPreflight } from "@/lib/primary/config";

export const dynamic = "force-dynamic";

function requirePreview() {
  try {
    const capability = requirePrimaryPreflight();
    if (capability.environmentId !== "isolated-preview" || process.env.VERCEL_ENV !== "preview") notFound();
  } catch { notFound(); }
}

export default async function PrimaryEventsPage() {
  requirePreview();
  const now = new Date();
  const events = await prisma.primaryEvent.findMany({
    where: { status: "APPROVED", organizer: { status: "APPROVED" }, ticketTypes: { some: { status: "ACTIVE" } }, startsAtLocal: { gt: now } },
    include: { organizer: { select: { displayName: true } }, ticketTypes: { where: { status: "ACTIVE" }, orderBy: { basePriceMinor: "asc" } } },
    orderBy: { startsAtLocal: "asc" }, take: 50,
  });
  return <main className="mx-auto min-h-screen max-w-5xl px-5 py-10">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">Isolated staging · Stripe test mode · no real tickets or money</div>
    <h1 className="mt-6 text-3xl font-bold">Primary events</h1>
    <p className="mt-2 text-slate-600">Approved general-admission events available in the pilot environment.</p>
    <div className="mt-8 grid gap-5 sm:grid-cols-2">
      {events.map((event) => <Link key={event.id} href={`/primary/events/${encodeURIComponent(event.id)}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-400">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{event.category}</p>
        <h2 className="mt-1 text-xl font-semibold">{event.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{event.organizer.displayName}</p>
        <p className="mt-3 text-sm">{event.startsAtLocal.toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short", timeZone: event.timezone })}</p>
        <p className="text-sm">{event.venueName} · {event.venueCity}, {event.venueRegion}</p>
        <p className="mt-4 font-semibold">From {(event.ticketTypes[0].basePriceMinor / 100).toLocaleString("en-CA", { style: "currency", currency: event.ticketTypes[0].currency })}</p>
      </Link>)}
    </div>
    {!events.length && <p className="mt-8 rounded-xl bg-slate-100 p-5">No approved pilot events are currently on sale.</p>}
  </main>;
}
