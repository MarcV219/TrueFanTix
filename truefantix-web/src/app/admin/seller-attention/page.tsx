"use client";

import React from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";

type AttentionSeller = {
  id: string; name: string; status: string; statusReason: string | null; createdAt: string; updatedAt: string;
  stripeAccountId: string | null; stripeDetailsSubmitted: boolean; stripePayoutsEnabled: boolean;
  severity: "ACTION_REQUIRED" | "INCOMPLETE"; acknowledged: boolean; acknowledgedAt: string | null; acknowledgedBy: string | null;
  user: { email: string; firstName: string; lastName: string } | null;
};

export default function SellerAttentionPage() {
  const [sellers, setSellers] = React.useState<AttentionSeller[]>([]);
  const [view, setView] = React.useState<"active" | "acknowledged" | "all">("active");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/seller-attention", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not load seller attention records.");
      setSellers(data.sellers || []);
    } catch (err: any) { setError(err?.message || "Could not load seller attention records."); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function acknowledge(sellerId: string) {
    setBusyId(sellerId); setError(null);
    try {
      const res = await apiFetch("/api/admin/seller-attention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sellerId }) });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not acknowledge this record.");
      await load();
    } catch (err: any) { setError(err?.message || "Could not acknowledge this record."); }
    finally { setBusyId(null); }
  }

  const visible = sellers.filter((seller) => view === "all" || (view === "active" ? !seller.acknowledged : seller.acknowledged));
  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Seller / Stripe Attention</h1>
      <p style={{ opacity: 0.72 }}>Pink records require an Admin decision. Yellow records are incomplete onboarding that may simply have been abandoned.</p>
      <Link href="/admin/tickets/verification" style={{ textDecoration: "underline" }}>← Back to Admin Queue</Link>
      <div style={{ display: "flex", gap: 8, margin: "18px 0", flexWrap: "wrap" }}>
        {(["active", "acknowledged", "all"] as const).map((option) => <button key={option} onClick={() => setView(option)} style={{ padding: "9px 12px", borderRadius: 999, border: "1px solid rgba(0,0,0,.15)", background: view === option ? "#064a93" : "white", color: view === option ? "white" : "inherit", fontWeight: 800, textTransform: "capitalize" }}>{option}</button>)}
        <button onClick={load} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,.15)", background: "white", fontWeight: 800 }}>Refresh</button>
      </div>
      {error ? <div role="alert" style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>{error}</div> : null}
      {loading ? <p>Loading…</p> : null}
      {!loading && !visible.length ? <div style={{ padding: 24, border: "1px solid rgba(0,0,0,.1)", borderRadius: 10 }}>No records in this view.</div> : null}
      <div style={{ display: "grid", gap: 12 }}>
        {visible.map((seller) => {
          const urgent = seller.severity === "ACTION_REQUIRED";
          return <section key={seller.id} style={{ padding: 16, borderRadius: 10, border: `1px solid ${urgent ? "rgba(239,68,68,.4)" : "rgba(245,158,11,.45)"}`, background: urgent ? "#fff1f2" : "#fffbeb", opacity: seller.acknowledged ? .72 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong>{seller.name}</strong>{seller.user ? <div>{seller.user.firstName} {seller.user.lastName} — {seller.user.email}</div> : <div>Legacy/orphan seller record — no linked user</div>}</div><strong style={{ color: urgent ? "#be123c" : "#a16207" }}>{urgent ? "ADMIN ACTION REQUIRED" : "INCOMPLETE ONBOARDING"}</strong></div>
            <div style={{ marginTop: 10, fontSize: 13 }}>Seller status: <strong>{seller.status}</strong> · Stripe account: <strong>{seller.stripeAccountId || "not linked"}</strong> · Details: <strong>{seller.stripeDetailsSubmitted ? "submitted" : "incomplete"}</strong> · Payouts: <strong>{seller.stripePayoutsEnabled ? "enabled" : "not enabled"}</strong></div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: .72 }}>Started {new Date(seller.createdAt).toLocaleString()} · Last changed {new Date(seller.updatedAt).toLocaleString()}</div>
            {seller.acknowledged ? <div style={{ marginTop: 10, fontSize: 13 }}>Acknowledged {seller.acknowledgedAt ? new Date(seller.acknowledgedAt).toLocaleString() : ""}{seller.acknowledgedBy ? ` by ${seller.acknowledgedBy}` : ""}</div> : <button onClick={() => acknowledge(seller.id)} disabled={busyId === seller.id} style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, border: 0, background: "#064a93", color: "white", fontWeight: 900 }}>{busyId === seller.id ? "Saving…" : "Acknowledge — remove from attention count"}</button>}
          </section>;
        })}
      </div>
    </main>
  );
}
