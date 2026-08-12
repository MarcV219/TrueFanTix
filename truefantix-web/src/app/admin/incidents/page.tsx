"use client";

import React from "react";
import Link from "next/link";

type Incident = { id: string; category: string; severity: string; summary: string; safeDetails: string | null; status: string; occurrenceCount: number; firstSeenAt: string; lastSeenAt: string; lastAlertedAt: string | null };

export default function IncidentsPage() {
  const [status, setStatus] = React.useState("OPEN");
  const [data, setData] = React.useState<{ incidents: Incident[]; openCount: number; criticalCount: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/admin/incidents?status=${status}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok || !json.ok) return setError(json.message || "Failed to load incidents.");
    setData(json);
  }, [status]);
  React.useEffect(() => { load(); }, [load]);
  async function setIncidentStatus(id: string, nextStatus: string) {
    const response = await fetch("/api/admin/incidents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: nextStatus }) });
    if (!response.ok) return setError("Could not update incident.");
    await load();
  }
  return <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h1 style={{ margin: 0 }}>Admin — Production Incidents</h1><Link href="/admin">Back to Admin</Link></div><button onClick={load}>Refresh</button></div>
    {data ? <p><strong>{data.openCount} open</strong> · <span style={{ color: data.criticalCount ? "#b91c1c" : "#166534" }}>{data.criticalCount} critical</span></p> : null}
    <label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option>OPEN</option><option>RESOLVED</option><option>ALL</option></select></label>
    {error ? <p role="alert" style={{ color: "#b91c1c" }}>{error}</p> : null}
    <div style={{ display: "grid", gap: 12, marginTop: 18 }}>{data?.incidents.map((incident) => {
      let details: { error?: string; references?: Record<string, unknown> } = {};
      try { details = incident.safeDetails ? JSON.parse(incident.safeDetails) : {}; } catch {}
      return <article key={incident.id} style={{ border: "1px solid #e5e7eb", borderLeft: `5px solid ${incident.severity === "CRITICAL" ? "#b91c1c" : incident.severity === "ERROR" ? "#c2410c" : "#ca8a04"}`, borderRadius: 8, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><strong>{incident.severity} · {incident.category}</strong><span>{incident.status}</span></div>
        <h2 style={{ fontSize: 18 }}>{incident.summary}</h2>
        {details.error ? <p>Error: {details.error}</p> : null}
        {details.references ? <p>{Object.entries(details.references).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</p> : null}
        <small>Occurrences: {incident.occurrenceCount} · First: {new Date(incident.firstSeenAt).toLocaleString()} · Last: {new Date(incident.lastSeenAt).toLocaleString()}</small><br/>
        <button style={{ marginTop: 10 }} onClick={() => setIncidentStatus(incident.id, incident.status === "OPEN" ? "RESOLVED" : "OPEN")}>{incident.status === "OPEN" ? "Mark resolved" : "Reopen"}</button>
      </article>;
    })}</div>
  </main>;
}
