"use client";

import React from "react";
import Link from "next/link";

type Lead = {
  email: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type WaitlistFilters = {
  source: string;
  from: string;
  to: string;
};

export default function EarlyAccessAdminPage() {
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [count, setCount] = React.useState<number>(0);
  const [latest, setLatest] = React.useState<Lead[]>([]);
  const [availableSources, setAvailableSources] = React.useState<string[]>([]);
  const [filters, setFilters] = React.useState<WaitlistFilters>({ source: "", from: "", to: "" });

  const buildQuery = React.useCallback((f: WaitlistFilters) => {
    const params = new URLSearchParams();
    params.set("format", "json");
    if (f.source) params.set("source", f.source);
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    return params.toString();
  }, []);

  const csvHref = React.useMemo(() => {
    const params = new URLSearchParams();
    if (filters.source) params.set("source", filters.source);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const qs = params.toString();
    return `/api/admin/early-access/export${qs ? `?${qs}` : ""}`;
  }, [filters]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const me = await meRes.json();
      const admin = !!me?.user?.flags?.isAdmin;
      setIsAdmin(admin);
      if (!admin) {
        setError("Admin access required.");
        return;
      }

      const res = await fetch(`/api/admin/early-access/export?${buildQuery(filters)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Failed to load waitlist");

      const items = Array.isArray(data.items) ? (data.items as Lead[]) : [];
      const sources = Array.isArray(data?.filters?.availableSources) ? (data.filters.availableSources as string[]) : [];
      setAvailableSources(sources);
      setCount(typeof data.count === "number" ? data.count : items.length);
      setLatest(items.slice(0, 20));
    } catch (e: any) {
      setError(e?.message || "Failed to load waitlist.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery, filters]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Early Access Waitlist</h1>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/account" style={{ textDecoration: "underline" }}>← Back to Account</Link>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={load} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)", background: "white", fontWeight: 800 }}>
            Refresh
          </button>
          <a
            href={csvHref}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(37,99,235,0.35)", background: "rgba(239,246,255,1)", fontWeight: 900, textDecoration: "none", color: "inherit" }}
          >
            Download CSV
          </a>
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)", background: "white", display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Filters</div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Source</span>
            <select
              value={filters.source}
              onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white" }}
            >
              <option value="">All sources</option>
              {availableSources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>From date</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white" }}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>To date</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white" }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={load}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.35)", background: "rgba(239,246,255,1)", fontWeight: 800 }}
          >
            Apply filters
          </button>
          <button
            onClick={() => setFilters({ source: "", from: "", to: "" })}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white", fontWeight: 700 }}
          >
            Clear filters
          </button>
        </div>
      </div>

      {error ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(255,0,0,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)" }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12, opacity: 0.8 }}>Loading waitlist…</div> : null}
      {isAdmin === false ? <div style={{ marginTop: 12, opacity: 0.85 }}>You are not authorized to view this page.</div> : null}

      {isAdmin ? (
        <>
          <div style={{ marginTop: 14, padding: 12, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, background: "white" }}>
            <div style={{ fontSize: 14, opacity: 0.75 }}>Total subscribers</div>
            <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.1 }}>{count}</div>
          </div>

          <div style={{ marginTop: 12, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, overflow: "hidden", background: "white" }}>
            <div style={{ padding: 10, fontWeight: 800, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>Latest signups</div>
            {latest.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.8 }}>No signups yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "rgba(249,250,251,1)" }}>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>Email</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>Source</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((l) => (
                      <tr key={`${l.email}-${l.createdAt}`}>
                        <td style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{l.email}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{l.source}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>{new Date(l.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
