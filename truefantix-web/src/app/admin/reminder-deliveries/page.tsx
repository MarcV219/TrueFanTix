"use client";

import React from "react";
import Link from "next/link";

type Delivery = {
  id: string; orderId: string; reminderType: string; recipient: string; windowStart: string;
  deadline: string; provider: string; status: string; providerResult: string | null;
  failureReason: string | null; attemptedAt: string; completedAt: string | null;
};

function dayOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function ReminderDeliveriesPage() {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [type, setType] = React.useState("ALL");
  const [from, setFrom] = React.useState(() => dayOffset(7));
  const [to, setTo] = React.useState(() => dayOffset(0));
  const [data, setData] = React.useState<{ deliveries: Delivery[]; total: number; failed24h: number; hasMore: boolean } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ status, type, from, to, limit: "250" });
    if (query.trim()) qs.set("q", query.trim());
    try {
      const response = await fetch(`/api/admin/reminder-deliveries?${qs}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.message || json.error || "Failed to load reminder deliveries.");
      setData(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load reminder deliveries.");
    } finally { setLoading(false); }
  }, [query, status, type, from, to]);

  React.useEffect(() => { load(); }, [load]);

  return <main style={{ maxWidth: 1240, margin: "40px auto", padding: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <div><h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Reminder Delivery Log</h1><Link href="/admin">Back to Admin</Link></div>
      <button onClick={load} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", fontWeight: 800 }}>{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); load(); }} style={{ display: "grid", gridTemplateColumns: "2fr repeat(4, minmax(140px, 1fr)) auto", gap: 10, alignItems: "end", marginBottom: 16 }}>
      <label style={{ display: "grid", gap: 4, fontWeight: 700, fontSize: 13 }}>Recipient, order, or error<input value={query} onChange={(e) => setQuery(e.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #d1d5db" }} /></label>
      <label style={{ display: "grid", gap: 4, fontWeight: 700, fontSize: 13 }}>Status<select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #d1d5db" }}><option>ALL</option><option>SENT</option><option>FAILED</option><option>ATTEMPTING</option></select></label>
      <label style={{ display: "grid", gap: 4, fontWeight: 700, fontSize: 13 }}>Reminder<select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #d1d5db" }}><option value="ALL">All</option><option value="SELLER_TRANSFER">Seller transfer</option><option value="BUYER_CONFIRMATION">Buyer confirmation</option></select></label>
      <label style={{ display: "grid", gap: 4, fontWeight: 700, fontSize: 13 }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #d1d5db" }} /></label>
      <label style={{ display: "grid", gap: 4, fontWeight: 700, fontSize: 13 }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: 9, borderRadius: 8, border: "1px solid #d1d5db" }} /></label>
      <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", fontWeight: 800 }}>Search</button>
    </form>
    {error ? <div role="alert" style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8, marginBottom: 12 }}>{error}</div> : null}
    {data ? <>
      <div style={{ display: "flex", gap: 16, marginBottom: 10 }}><strong>{data.total} matching deliveries</strong><span style={{ color: data.failed24h ? "#b91c1c" : "#166534" }}>{data.failed24h} failed in the last 24 hours</span>{data.hasMore ? <span>Showing first 250</span> : null}</div>
      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8, background: "white" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ textAlign: "left", background: "#f8fafc" }}>{["Attempt", "Status", "Reminder / window", "Recipient", "Order", "Provider result", "Failure reason"].map((label) => <th key={label} style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>{label}</th>)}</tr></thead><tbody>
        {data.deliveries.map((item) => <tr key={item.id}>{[
          new Date(item.attemptedAt).toLocaleString(),
          <strong key="status" style={{ color: item.status === "FAILED" ? "#b91c1c" : item.status === "SENT" ? "#166534" : "#92400e" }}>{item.status}</strong>,
          <span key="window">{item.reminderType === "SELLER_TRANSFER" ? "Seller transfer" : "Buyer confirmation"}<br/><small>Window: {new Date(item.windowStart).toLocaleString()}<br/>Deadline: {new Date(item.deadline).toLocaleString()}</small></span>,
          item.recipient,
          <Link key="order" href={`/admin/orders?q=${encodeURIComponent(item.orderId)}`}>{item.orderId}</Link>,
          `${item.provider}: ${item.providerResult || "—"}`,
          item.failureReason || "—",
        ].map((cell, index) => <td key={index} style={{ padding: 10, borderBottom: "1px solid #f1f5f9", verticalAlign: "top", wordBreak: "break-word" }}>{cell}</td>)}</tr>)}
        {!loading && data.deliveries.length === 0 ? <tr><td colSpan={7} style={{ padding: 16 }}>No reminder deliveries match these filters.</td></tr> : null}
      </tbody></table></div>
    </> : loading ? <div>Loading reminder deliveries…</div> : null}
  </main>;
}
