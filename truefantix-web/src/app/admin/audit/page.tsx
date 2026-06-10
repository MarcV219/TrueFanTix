"use client";

import React from "react";
import Link from "next/link";

type AuditLog = {
  id: string;
  createdAt: string;
  action: string;
  userId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: any;
  ipAddress: string | null;
  userAgent: string | null;
};

type AuditResponse = {
  ok: true;
  logs: AuditLog[];
  total: number;
  hasMore: boolean;
};

function todayMinus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function stringifyMetadata(value: any) {
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function AdminAuditPage() {
  const [action, setAction] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [targetType, setTargetType] = React.useState("");
  const [targetId, setTargetId] = React.useState("");
  const [from, setFrom] = React.useState(() => todayMinus(7));
  const [to, setTo] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = React.useState<AuditResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (action.trim()) qs.set("action", action.trim());
      if (userId.trim()) qs.set("userId", userId.trim());
      if (targetType.trim()) qs.set("targetType", targetType.trim());
      if (targetId.trim()) qs.set("targetId", targetId.trim());
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("limit", "100");

      const res = await fetch(`/api/admin/audit?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load audit logs.");
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [action, userId, targetType, targetId, from, to]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Audit Log</h1>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Admin dashboard</Link>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end", marginBottom: 16 }}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          Action
          <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="ADMIN_ORDER_ACTION" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          User ID
          <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user id" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          Target Type
          <input value={targetType} onChange={(event) => setTargetType(event.target.value)} placeholder="ORDER" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          Target ID
          <input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="target id" style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          Search
        </button>
      </form>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading audit logs...</div> : null}

      {data ? (
        <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <strong>{data.total} matching audit entries</strong>
            {data.hasMore ? <span style={{ opacity: 0.75 }}>Showing first 100</span> : null}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {data.logs.map((log) => (
              <div key={log.id} style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{log.action}</strong>
                  <span>{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ opacity: 0.75 }}>User: {log.userId || "-"} | Target: {log.targetType || "-"} {log.targetId || ""}</div>
                {log.metadata ? <div style={{ marginTop: 4, opacity: 0.75, wordBreak: "break-word" }}>Metadata: {stringifyMetadata(log.metadata)}</div> : null}
                <div style={{ marginTop: 4, opacity: 0.6 }}>IP: {log.ipAddress || "-"} | UA: {log.userAgent || "-"}</div>
              </div>
            ))}
            {!loading && data.logs.length === 0 ? <div style={{ opacity: 0.75 }}>No audit entries found.</div> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
