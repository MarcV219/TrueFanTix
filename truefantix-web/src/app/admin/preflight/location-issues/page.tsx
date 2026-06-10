"use client";

import React from "react";
import Link from "next/link";

type LocationIssueData = {
  ok: true;
  scanned: { tickets: number; paidOrdersWithAdminFee: number };
  counts: { unresolvedTickets: number; ordersWithNoTaxRegion: number };
  unresolvedTickets: Array<{
    id: string;
    title: string;
    venue: string;
    ticketVenue: string;
    eventVenue: string | null;
    date: string;
    status: string;
    priceCents: number;
    createdAt: string;
    seller: { id: string; name: string };
  }>;
  ordersWithNoTaxRegion: Array<{
    id: string;
    status: string;
    createdAt: string;
    amountCents: number;
    adminFeeCents: number;
    adminFeeTaxCents: number;
    totalCents: number;
    ticket: { title: string; venue: string; date: string } | null;
  }>;
};

function cents(value: number) {
  return `$${(Number(value || 0) / 100).toFixed(2)}`;
}

export default function AdminLocationIssuesPage() {
  const [data, setData] = React.useState<LocationIssueData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/preflight/location-issues?take=200", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load location issues.");
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load location issues.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Location Preflight</h1>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Admin dashboard</Link>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <p style={{ marginTop: 0, opacity: 0.78 }}>
        Finds active listings whose venue cannot resolve to a state/province for checkout tax, plus completed paid orders that have an admin fee but no tax region snapshot.
      </p>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading && !data ? <div style={{ opacity: 0.75 }}>Loading preflight report...</div> : null}

      {data ? (
        <div style={{ display: "grid", gap: 18 }}>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Scanned Listings</div>
              <div style={{ fontSize: 24, fontWeight: 950 }}>{data.scanned.tickets}</div>
            </div>
            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: data.counts.unresolvedTickets ? "rgba(255,251,235,1)" : "white", padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Unresolved Listings</div>
              <div style={{ fontSize: 24, fontWeight: 950 }}>{data.counts.unresolvedTickets}</div>
            </div>
            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: data.counts.ordersWithNoTaxRegion ? "rgba(254,242,242,1)" : "white", padding: 16 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Paid Orders Missing Tax Region</div>
              <div style={{ fontSize: 24, fontWeight: 950 }}>{data.counts.ordersWithNoTaxRegion}</div>
            </div>
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 950 }}>Listings Needing Location Cleanup</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {data.unresolvedTickets.map((ticket) => (
                <div key={ticket.id} style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{ticket.title}</strong>
                    <span>{ticket.status} | {cents(ticket.priceCents)}</span>
                  </div>
                  <div style={{ opacity: 0.78 }}>Venue: {ticket.venue || "-"}</div>
                  <div style={{ opacity: 0.68 }}>Seller: {ticket.seller?.name || "-"} | Date: {ticket.date || "-"}</div>
                  <div style={{ opacity: 0.68 }}>Ticket ID: {ticket.id}</div>
                </div>
              ))}
              {!loading && data.unresolvedTickets.length === 0 ? <div style={{ opacity: 0.75 }}>No active listing location issues found.</div> : null}
            </div>
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 950 }}>Paid Orders Missing Tax Region</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {data.ordersWithNoTaxRegion.map((order) => (
                <Link key={order.id} href={`/admin/orders?q=${encodeURIComponent(order.id)}`} style={{ color: "inherit", textDecoration: "none", padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{order.ticket?.title || order.id}</strong>
                    <span>{order.status} | Total {cents(order.totalCents)}</span>
                  </div>
                  <div style={{ opacity: 0.78 }}>Admin fee {cents(order.adminFeeCents)} | Tax {cents(order.adminFeeTaxCents)}</div>
                  <div style={{ opacity: 0.68 }}>{new Date(order.createdAt).toLocaleString()} | {order.ticket?.venue || "-"}</div>
                </Link>
              ))}
              {!loading && data.ordersWithNoTaxRegion.length === 0 ? <div style={{ opacity: 0.75 }}>No paid orders missing a tax region.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
