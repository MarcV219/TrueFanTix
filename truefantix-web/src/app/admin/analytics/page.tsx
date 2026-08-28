"use client";

import React from "react";
import Link from "next/link";

type Metrics = {
  visitors: number;
  pageViews: number;
  signups: number;
  verifiedUsers: number;
  followers: number;
  firstListings: number;
  completedTransactions: number;
};

type CampaignRow = Metrics & { source: string; medium: string | null; campaign: string | null };

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "white",
};

export default function CampaignAnalyticsPage() {
  const initialTo = React.useMemo(() => new Date(), []);
  const initialFrom = React.useMemo(() => new Date(initialTo.getTime() - 29 * 86400000), [initialTo]);
  const [from, setFrom] = React.useState(dateInput(initialFrom));
  const [to, setTo] = React.useState(dateInput(initialTo));
  const [totals, setTotals] = React.useState<Metrics | null>(null);
  const [items, setItems] = React.useState<CampaignRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/admin/analytics/campaigns?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || "Unable to load analytics.");
      setTotals(data.totals);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load analytics.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  React.useEffect(() => { void load(); }, [load]);

  const cards = totals ? [
    ["Visitors", totals.visitors, `${totals.pageViews.toLocaleString()} page views`],
    ["Registrations", totals.signups, `${percent(totals.signups, totals.visitors)} of visitors`],
    ["Verified users", totals.verifiedUsers, `${percent(totals.verifiedUsers, totals.signups)} of registrations`],
    ["Followers", totals.followers, `${percent(totals.followers, totals.signups)} of registrations`],
    ["First-time sellers", totals.firstListings, `${percent(totals.firstListings, totals.signups)} listed tickets`],
    ["Completed transactors", totals.completedTransactions, `${percent(totals.completedTransactions, totals.signups)} bought or sold`],
  ] as const : [];

  return (
    <main style={{ maxWidth: 1280, margin: "36px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950 }}>Campaign analytics</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.75 }}>Aggregate acquisition and activation results. Admin access only.</p>
          <Link href="/account" style={{ display: "inline-block", marginTop: 8, textDecoration: "underline" }}>← Back to Account</Link>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12 }}>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #bbb" }} /></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12 }}>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #bbb" }} /></label>
          <button onClick={() => void load()} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(13,148,136,.35)", background: "rgba(240,253,250,1)", fontWeight: 850 }}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {error ? <div style={{ ...cardStyle, marginTop: 18, color: "#991b1b", background: "#fef2f2" }}>{error}</div> : null}

      <section aria-label="Campaign totals" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginTop: 20 }}>
        {cards.map(([label, value, detail]) => <div key={label} style={cardStyle}><div style={{ fontSize: 13, opacity: 0.7 }}>{label}</div><div style={{ fontSize: 30, fontWeight: 950, marginTop: 4 }}>{value.toLocaleString()}</div><div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{detail}</div></div>)}
      </section>

      <section style={{ ...cardStyle, marginTop: 18, overflowX: "auto" }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Results by campaign</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead><tr>{["Source", "Medium", "Campaign", "Visitors", "Signups", "Signup rate", "Verified", "Followers", "Listings", "Completed"].map((heading) => <th key={heading} style={{ padding: "9px 7px", textAlign: heading === "Source" || heading === "Medium" || heading === "Campaign" ? "left" : "right", borderBottom: "1px solid #ddd", fontSize: 12 }}>{heading}</th>)}</tr></thead>
          <tbody>
            {items.map((item) => <tr key={`${item.source}|${item.medium}|${item.campaign}`}>
              <td style={{ padding: "10px 7px", borderBottom: "1px solid #eee", fontWeight: 800 }}>{item.source}</td>
              <td style={{ padding: "10px 7px", borderBottom: "1px solid #eee" }}>{item.medium || "—"}</td>
              <td style={{ padding: "10px 7px", borderBottom: "1px solid #eee" }}>{item.campaign || "—"}</td>
              {[item.visitors, item.signups, percent(item.signups, item.visitors), item.verifiedUsers, item.followers, item.firstListings, item.completedTransactions].map((value, index) => <td key={index} style={{ padding: "10px 7px", textAlign: "right", borderBottom: "1px solid #eee" }}>{typeof value === "number" ? value.toLocaleString() : value}</td>)}
            </tr>)}
            {!loading && items.length === 0 ? <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", opacity: 0.7 }}>No activity in this date range.</td></tr> : null}
          </tbody>
        </table>
      </section>
      <p style={{ fontSize: 12, opacity: 0.65, marginTop: 12 }}>Attribution uses sanitized campaign labels and referring domains. No names, email addresses, IP addresses, or full referring URLs appear here.</p>
    </main>
  );
}
