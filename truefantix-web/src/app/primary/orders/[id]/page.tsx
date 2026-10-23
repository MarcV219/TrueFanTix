import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { requirePrimaryPreflight } from "@/lib/primary/config";

export const dynamic = "force-dynamic";

export default async function PrimaryOrderPage({ params }: { params: Promise<{ id: string }> }) {
  try { const capability = requirePrimaryPreflight(); if (capability.environmentId !== "isolated-preview" || process.env.VERCEL_ENV !== "preview") notFound(); } catch { notFound(); }
  const userId = await getUserIdFromSessionCookie(); if (!userId) notFound(); const { id } = await params;
  const order = await prisma.primaryOrder.findFirst({ where: { id, buyerUserId: userId }, include: { event: true, lines: true, paymentAttempt: true, admissionTickets: { include: { credential: true }, orderBy: { unitNumber: "asc" } } } });
  if (!order) notFound();
  return <main className="mx-auto min-h-screen max-w-3xl px-5 py-10"><div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold">Isolated staging · Stripe test mode</div><h1 className="mt-6 text-3xl font-bold">Order status</h1><p className="mt-2 text-slate-600">{order.event.title}</p><div className="mt-6 grid gap-3 sm:grid-cols-3">{[["Order", order.status], ["Payment", order.paymentAttempt?.status ?? "NOT_STARTED"], ["Tickets", String(order.admissionTickets.length)]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-4"><p className="text-xs text-slate-500">{label}</p><p className="font-bold">{value}</p></div>)}</div>{order.admissionTickets.length > 0 && <section className="mt-6 rounded-2xl border border-emerald-200 p-5"><h2 className="text-xl font-semibold">Admission tickets issued</h2>{order.admissionTickets.map((ticket) => <div key={ticket.id} className="mt-3 rounded-lg bg-emerald-50 p-4 text-sm"><strong>{order.lines[0]?.ticketTypeNameSnapshot} #{ticket.unitNumber}</strong><br />Status: {ticket.status}<br />Credential: {ticket.credential?.id}</div>)}</section>}<p className="mt-6 text-sm text-slate-500">If the payment was just submitted, refresh after Stripe’s test webhook is delivered.</p></main>;
}
