import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import PrimaryCheckoutPanel from "./primary-checkout-panel";

export const dynamic = "force-dynamic";

export default async function PrimaryEventPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const capability = requirePrimaryPreflight();
    if (capability.environmentId !== "isolated-preview" || process.env.VERCEL_ENV !== "preview") notFound();
  } catch { notFound(); }
  const { id } = await params;
  const event = await prisma.primaryEvent.findFirst({ where: { id, status: "APPROVED", organizer: { status: "APPROVED" } }, include: { organizer: { select: { displayName: true } }, ticketTypes: { where: { status: "ACTIVE" }, orderBy: { basePriceMinor: "asc" } }, reservations: { where: { OR: [{ status: "PAYMENT_COMMITTED" }, { status: "HELD", expiresAt: { gt: new Date() } }] }, select: { ticketTypeId: true, quantity: true } } } });
  if (!event || event.startsAtLocal <= new Date()) notFound();
  const ticketTypes = event.ticketTypes.map((type) => ({ ...type, available: Math.max(0, type.allocatedQuantity - event.reservations.filter((item) => item.ticketTypeId === type.id).reduce((sum, item) => sum + item.quantity, 0)) }));
  return <main className="mx-auto min-h-screen max-w-4xl px-5 py-10">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">Isolated staging · Stripe test cards only · nothing here grants entry to a real event</div>
    <Link href="/primary/events" className="mt-6 inline-block text-sm font-semibold text-blue-700">← All primary events</Link>
    <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_360px]">
      <article>
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">{event.category}</p>
        <h1 className="mt-1 text-3xl font-bold">{event.title}</h1>
        <p className="mt-2 text-slate-600">Presented by {event.organizer.displayName}</p>
        <div className="mt-6 space-y-2 rounded-2xl bg-slate-50 p-5 text-sm">
          <p><strong>Date:</strong> {event.startsAtLocal.toLocaleString("en-CA", { dateStyle: "full", timeStyle: "short", timeZone: event.timezone })}</p>
          <p><strong>Venue:</strong> {event.venueName}, {event.venueAddressLine1}, {event.venueCity}, {event.venueRegion} {event.venuePostalCode}</p>
          <p><strong>Timezone:</strong> {event.timezone}</p>
        </div>
        <p className="mt-6 whitespace-pre-wrap text-slate-700">{event.description}</p>
        {event.accessibilityInfo && <p className="mt-5 text-sm"><strong>Accessibility:</strong> {event.accessibilityInfo}</p>}
        <div className="mt-6 rounded-xl border border-slate-200 p-4 text-sm"><strong>Pilot policy:</strong> {event.draftPolicyText}</div>
      </article>
      <PrimaryCheckoutPanel eventId={event.id} ticketTypes={ticketTypes.map((type) => ({ id: type.id, name: type.name, description: type.description, currency: type.currency, basePriceMinor: type.basePriceMinor, minimumPerOrder: type.minimumPerOrder, maximumPerOrder: type.maximumPerOrder, available: type.available }))} />
    </div>
  </main>;
}
