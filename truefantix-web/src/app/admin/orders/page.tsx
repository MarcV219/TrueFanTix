"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type AdminOrder = {
  id: string;
  status: string;
  createdAt: string;
  sellerId: string;
  buyerSellerId: string;
  amountCents: number;
  adminFeeCents: number;
  adminFeeTaxCents: number;
  taxRateBps: number;
  taxRegionCode: string | null;
  taxCountryCode: string | null;
  taxLabel: string | null;
  totalCents: number;
  transferVerificationStatus: string | null;
  transferVerificationReason: string | null;
  buyerConfirmationStatus: string | null;
  disputeWindowEndsAt: string | null;
  seller: { id: string; name: string };
  buyerSeller: { id: string; name: string };
  payment: null | {
    status: string;
    provider: string;
    providerRef: string;
    amountCents: number;
    currency: string;
  };
  items: Array<{
    id: string;
    priceCents: number;
    faceValueCents: number | null;
    ticket: {
      id: string;
      title: string;
      venue: string;
      date: string;
      status: string;
      reservedUntil: string | null;
      soldAt: string | null;
    };
  }>;
};

function cents(value: number) {
  return `$${(Number(value || 0) / 100).toFixed(2)}`;
}

function rate(bps: number) {
  const percent = Number(bps || 0) / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2)}%`;
}

function AdminOrdersContent() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";
  const initialStatus = params.get("status") || "";
  const [q, setQ] = React.useState(initialQ);
  const [status, setStatus] = React.useState(initialStatus);
  const [orders, setOrders] = React.useState<AdminOrder[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (query = q, orderStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ q: query, status: orderStatus, take: "50" });
      const res = await fetch(`/api/admin/orders?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load orders.");
      setOrders(Array.isArray(json.orders) ? json.orders : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  React.useEffect(() => {
    load(initialQ, initialStatus);
  }, [initialQ, initialStatus, load]);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Orders</h1>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Admin</Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link href="/admin/orders?status=DISPUTED" style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(185,28,28,.28)", background: "rgba(254,242,242,1)", color: "inherit", textDecoration: "none", fontWeight: 900 }}>
          Open disputes
        </Link>
        <Link href="/admin/orders?status=RESOLVED_DISPUTES" style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(22,101,52,.28)", background: "rgba(240,253,244,1)", color: "inherit", textDecoration: "none", fontWeight: 900 }}>
          Disputes resolved
        </Link>
        <Link href="/admin/orders?status=HUMAN_REVIEW" style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(180,83,9,.28)", background: "rgba(255,247,237,1)", color: "inherit", textDecoration: "none", fontWeight: 900 }}>
          Transfer proof reviews
        </Link>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(q, status);
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search order ID, Stripe ref, event, venue, seller"
          style={{ flex: "1 1 320px", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}
        >
          <option value="">All statuses</option>
          <option value="DISPUTED">OPEN DISPUTES</option>
          <option value="RESOLVED_DISPUTES">DISPUTES RESOLVED</option>
          <option value="HUMAN_REVIEW">TRANSFER PROOF HUMAN REVIEW</option>
          {["PENDING", "PAID", "DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          Search
        </button>
      </form>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading orders...</div> : null}

      <div style={{ display: "grid", gap: 10 }}>
        {orders.map((order) => (
          <section key={order.id} style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <Link href={`/admin/orders/${encodeURIComponent(order.id)}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <div style={{ fontWeight: 950 }}>{order.status} | {order.id}</div>
                </Link>
                {order.buyerConfirmationStatus === "DISPUTED" ? (
                  <div style={{ display: "inline-block", marginTop: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(254,226,226,1)", color: "rgba(153,27,27,1)", fontSize: 12, fontWeight: 900 }}>
                    Dispute open
                  </div>
                ) : order.transferVerificationStatus === "MANUAL_REVIEW" ? (
                  <div style={{ display: "inline-block", marginTop: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(255,237,213,1)", color: "rgba(154,52,18,1)", fontSize: 12, fontWeight: 900 }}>
                    Transfer proof — human review requested
                  </div>
                ) : order.transferVerificationReason?.includes?.("BUYER_DISPUTE") ? (
                  <div style={{ display: "inline-block", marginTop: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(220,252,231,1)", color: "rgba(22,101,52,1)", fontSize: 12, fontWeight: 900 }}>
                    Dispute resolved
                  </div>
                ) : null}
                <div style={{ opacity: 0.75, fontSize: 13 }}>Created {new Date(order.createdAt).toLocaleString()}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Seller: {order.seller?.name || order.sellerId} | Buyer: {order.buyerSeller?.name || order.buyerSellerId}</div>
                {order.disputeWindowEndsAt ? (
                  <div style={{ opacity: 0.75, fontSize: 13 }}>Buyer confirmation window: {new Date(order.disputeWindowEndsAt).toLocaleString()}</div>
                ) : null}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 950, fontSize: 20 }}>{cents(order.totalCents)}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>{order.payment?.status || "No payment"}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 12, fontSize: 13 }}>
              <div>Subtotal: <strong>{cents(order.amountCents)}</strong></div>
              <div>Admin fee: <strong>{cents(order.adminFeeCents)}</strong></div>
              <div>{order.taxLabel || "Tax"}: <strong>{cents(order.adminFeeTaxCents)}</strong></div>
              <div>Tax rate: <strong>{rate(order.taxRateBps)} {order.taxRegionCode || ""}</strong></div>
              <div>Total: <strong>{cents(order.totalCents)}</strong></div>
            </div>
            {order.payment ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                Payment: {order.payment.provider} | {order.payment.providerRef} | {cents(order.payment.amountCents)} {order.payment.currency}
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {order.items.map((item) => (
                <div key={item.id} style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                  <Link href={`/admin/tickets/${encodeURIComponent(item.ticket.id)}`} style={{ color: "inherit", textDecoration: "none" }}>
                    <strong>{item.ticket.title}</strong>
                  </Link>
                  {" | "}{item.ticket.venue} | {item.ticket.date}
                  <div style={{ opacity: 0.75 }}>Ticket {item.ticket.status} | Price {cents(item.priceCents)}{item.faceValueCents != null ? ` | Face ${cents(item.faceValueCents)}` : ""}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <Link href={`/admin/orders/${encodeURIComponent(order.id)}`} style={{ textDecoration: "underline", fontWeight: 800 }}>Review full transaction details</Link>
            </div>
          </section>
        ))}
        {!loading && orders.length === 0 ? <div style={{ opacity: 0.75 }}>No orders found.</div> : null}
      </div>
    </main>
  );
}

export default function AdminOrdersPage() {
  return (
    <React.Suspense fallback={<main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>Loading orders...</main>}>
      <AdminOrdersContent />
    </React.Suspense>
  );
}
