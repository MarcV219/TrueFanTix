"use client";

import React from "react";
import Link from "next/link";

type Data = {
  promotion: { active: boolean; startsAt: string; endsAt: string | null };
  summary: { participants: number; signups: number; saleOrders: number; ticketsSold: number; tokensAwarded: number };
  items: Array<{ id: string; kind: string; ticketCount: number; tokensAwarded: number; orderId: string | null; occurredAt: string; user: { email: string; firstName: string; lastName: string } }>;
};

export default function LaunchPromotionAdminPage() {
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => { fetch("/api/admin/promotions/launch", { cache: "no-store" }).then(async (res) => { const json = await res.json(); if (!res.ok) throw new Error(json.message || "Could not load promotion"); setData(json); }).catch((e) => setError(e.message)); }, []);
  return <main style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
    <Link href="/admin">← Back to Admin</Link>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <div><h1>Launch Promotion</h1><p>{data?.promotion.active ? "Active" : "Ended"} · Started {data ? new Date(data.promotion.startsAt).toLocaleString() : "…"}</p></div>
      <a href="/api/admin/promotions/launch?format=csv" style={{ fontWeight: 800 }}>Download CSV</a>
    </div>
    {error ? <div role="alert" style={{ color: "#991b1b" }}>{error}</div> : null}
    {data ? <>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {Object.entries(data.summary).map(([key, value]) => <div key={key} style={{ padding: 14, background: "white", border: "1px solid #ddd", borderRadius: 8 }}><div style={{ fontSize: 13 }}>{key.replace(/([A-Z])/g, " $1")}</div><strong style={{ fontSize: 26 }}>{value}</strong></div>)}
      </section>
      <div style={{ overflowX: "auto", marginTop: 18, background: "white", border: "1px solid #ddd", borderRadius: 8 }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Qualified", "User", "Reason", "Tickets", "Tokens", "Order"].map((h) => <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>{h}</th>)}</tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td style={{ padding: 10 }}>{new Date(item.occurredAt).toLocaleString()}</td><td style={{ padding: 10 }}>{item.user.firstName} {item.user.lastName}<br/><small>{item.user.email}</small></td><td style={{ padding: 10 }}>{item.kind}</td><td style={{ padding: 10 }}>{item.ticketCount || "—"}</td><td style={{ padding: 10 }}>+{item.tokensAwarded}</td><td style={{ padding: 10 }}>{item.orderId || "—"}</td></tr>)}</tbody></table>{data.items.length === 0 ? <p style={{ padding: 12 }}>No qualifying activity yet.</p> : null}</div>
    </> : <p>Loading…</p>}
  </main>;
}
