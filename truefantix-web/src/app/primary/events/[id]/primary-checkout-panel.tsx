"use client";

import { FormEvent, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { apiFetch } from "@/lib/api-fetch";

type TicketType = { id: string; name: string; description: string | null; currency: string; basePriceMinor: number; minimumPerOrder: number | null; maximumPerOrder: number | null; available: number };
type Checkout = { orderId: string; expiresAt: string; amountMinor: number; currency: string; clientSecret: string; publishableKey: string };

function PaymentForm({ checkout }: { checkout: Checkout }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!stripe || !elements) return;
    setBusy(true); setError("");
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/primary/orders/${encodeURIComponent(checkout.orderId)}` } });
    if (result.error) { setError(result.error.message ?? "Payment failed."); setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-4"><PaymentElement /><button disabled={!stripe || busy} className="w-full rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "Processing…" : `Pay ${(checkout.amountMinor / 100).toLocaleString("en-CA", { style: "currency", currency: checkout.currency })}`}</button>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<p className="text-xs text-slate-500">Use a Stripe test card such as 4242 4242 4242 4242. No real charge is possible.</p></form>;
}

export default function PrimaryCheckoutPanel({ eventId, ticketTypes }: { eventId: string; ticketTypes: TicketType[] }) {
  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? ""); const selected = ticketTypes.find((item) => item.id === ticketTypeId);
  const [quantity, setQuantity] = useState(selected?.minimumPerOrder ?? 1); const [checkout, setCheckout] = useState<Checkout | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const stripe = useMemo(() => checkout ? loadStripe(checkout.publishableKey) : null, [checkout]);
  async function reserve() {
    if (!selected) return; setBusy(true); setError("");
    const idempotencyKey = crypto.randomUUID();
    const response = await apiFetch(`/api/primary/events/${encodeURIComponent(eventId)}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketTypeId, quantity, idempotencyKey }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error === "STAGING_BUYER_REQUIRED" || body?.error === "NOT_AUTHENTICATED" ? "Open the staging console and choose Use buyer first." : body?.error ?? "Checkout could not start."); setBusy(false); return; }
    setCheckout(body.checkout); setBusy(false);
  }
  if (!selected) return <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">No tickets available.</aside>;
  if (checkout && stripe) return <aside className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Test checkout</h2><p className="mt-1 text-xs text-slate-500">Reservation held until {new Date(checkout.expiresAt).toLocaleTimeString()}</p><Elements stripe={stripe} options={{ clientSecret: checkout.clientSecret }}><PaymentForm checkout={checkout} /></Elements></aside>;
  const minimum = selected.minimumPerOrder ?? 1; const maximum = Math.min(selected.maximumPerOrder ?? 10, selected.available);
  return <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Tickets</h2><label className="mt-4 block text-sm font-semibold">Ticket type<select className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={ticketTypeId} onChange={(event) => { const next = ticketTypes.find((item) => item.id === event.target.value); setTicketTypeId(event.target.value); setQuantity(next?.minimumPerOrder ?? 1); }}>{ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {(type.basePriceMinor / 100).toLocaleString("en-CA", { style: "currency", currency: type.currency })}</option>)}</select></label><p className="mt-2 text-xs text-slate-500">{selected.description} · {selected.available} remaining</p><label className="mt-4 block text-sm font-semibold">Quantity<input className="mt-1 w-full rounded-lg border border-slate-300 p-3" type="number" min={minimum} max={maximum} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><div className="mt-5 flex justify-between border-t pt-4 font-bold"><span>Total</span><span>{(selected.basePriceMinor * quantity / 100).toLocaleString("en-CA", { style: "currency", currency: selected.currency })}</span></div><button onClick={() => void reserve()} disabled={busy || selected.available < minimum || quantity < minimum || quantity > maximum} className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "Preparing…" : "Reserve and continue"}</button>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<p className="mt-3 text-xs text-slate-500">Face value only for this pilot. Fee and tax policy is not yet approved.</p></aside>;
}
