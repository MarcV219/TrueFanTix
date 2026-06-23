"use client";

import React from "react";
import Link from "next/link";

type AdminTicket = {
  id: string;
  title: string;
  venue: string;
  date: string;
  row: string | null;
  seat: string | null;
  priceCents: number;
  faceValueCents: number | null;
  adminFeePaidCents: number;
  currency: string;
  status: string;
  verificationStatus: string;
  verificationScore: number | null;
  createdAt: string;
  seller: { id: string; name: string; user: { email: string; firstName: string; lastName: string } | null };
  orderItems: Array<{ orderId: string; order: { id: string; status: string; totalCents: number; currency: string } }>;
};

function money(cents: number, currency = "CAD") {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}

export default function AdminTicketsPage() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [verificationStatus, setVerificationStatus] = React.useState("");
  const [tickets, setTickets] = React.useState<AdminTicket[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ q, status, verificationStatus, take: "100" });
      const res = await fetch(`/api/admin/tickets?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load listings.");
      setTickets(Array.isArray(json.tickets) ? json.tickets : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load listings.");
    } finally {
      setLoading(false);
    }
  }, [q, status, verificationStatus]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin - Listings</h1>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Admin</Link>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search listing ID, order ID, event, venue, seller, email, row, seat"
          style={{ flex: "1 1 360px", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}>
          <option value="">All listing statuses</option>
          {["AVAILABLE", "RESERVED", "SOLD", "WITHDRAWN"].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value)} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}>
          <option value="">All verification statuses</option>
          {["PENDING", "NEEDS_REVIEW", "VERIFIED", "REJECTED"].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>Search</button>
      </form>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading listings...</div> : null}

      <div style={{ display: "grid", gap: 10 }}>
        {tickets.map((ticket) => (
          <section key={ticket.id} style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <Link href={`/admin/tickets/${encodeURIComponent(ticket.id)}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <div style={{ fontWeight: 950 }}>{ticket.title}</div>
                </Link>
                <div style={{ opacity: 0.75, fontSize: 13 }}>{ticket.venue} | {ticket.date} | Row {ticket.row || "-"} Seat {ticket.seat || "-"}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Seller: {ticket.seller?.name || "-"} {ticket.seller?.user?.email ? `| ${ticket.seller.user.email}` : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 950, fontSize: 18 }}>{money(ticket.priceCents, ticket.currency)}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>{ticket.status} | {ticket.verificationStatus}{ticket.verificationScore != null ? ` (${ticket.verificationScore})` : ""}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <Link href={`/admin/tickets/${encodeURIComponent(ticket.id)}`} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.22)", background: "rgba(239,246,255,1)", color: "inherit", textDecoration: "none", fontWeight: 800 }}>Review listing</Link>
              {ticket.orderItems.map((item) => (
                <Link key={item.orderId} href={`/admin/orders/${encodeURIComponent(item.orderId)}`} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.10)", color: "inherit", textDecoration: "none", fontWeight: 800 }}>
                  Order {item.order.status}
                </Link>
              ))}
            </div>
          </section>
        ))}
        {!loading && tickets.length === 0 ? <div style={{ opacity: 0.75 }}>No listings found.</div> : null}
      </div>
    </main>
  );
}
