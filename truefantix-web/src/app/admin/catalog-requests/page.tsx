"use client";

import React from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/api-fetch";

type CatalogRequest = {
  id: string;
  createdAt: string;
  requestedType: string;
  requestedValue: string;
  notes: string | null;
  status: string;
  adminNotes: string | null;
  emailSentAt: string | null;
  emailError: string | null;
  user: {
    email: string;
    firstName: string;
    lastName: string;
  };
  resolvedCatalogEntity?: {
    id: string;
    canonicalName: string;
    provider: string;
  } | null;
};

type CatalogSuggestion = {
  catalogEntityId?: string;
  label: string;
  provider?: string;
  subtitle?: string;
};

export default function CatalogRequestsAdminPage() {
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [status, setStatus] = React.useState("PENDING");
  const [requests, setRequests] = React.useState<CatalogRequest[]>([]);
  const [entityIds, setEntityIds] = React.useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = React.useState<Record<string, string>>({});
  const [matchesById, setMatchesById] = React.useState<Record<string, CatalogSuggestion[]>>({});
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      const me = await meRes.json();
      const admin = !!me?.user?.flags?.isAdmin;
      setIsAdmin(admin);
      if (!admin) {
        setRequests([]);
        setError("Admin access required.");
        return;
      }

      const res = await fetch(`/api/admin/catalog-requests?status=${encodeURIComponent(status)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not load catalog requests.");
      }
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (e: any) {
      setError(e?.message || "Could not load catalog requests.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function reviewRequest(id: string, nextStatus: "FULFILLED" | "REJECTED") {
    setBusyId(id);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson(`/api/admin/catalog-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          catalogEntityId: nextStatus === "FULFILLED" ? entityIds[id]?.trim() : null,
          adminNotes: adminNotes[id]?.trim() || null,
        }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not update catalog request.");
      }

      setOk(nextStatus === "FULFILLED" ? "Request fulfilled and favorite added." : "Request rejected.");
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not update catalog request.");
    } finally {
      setBusyId(null);
    }
  }

  async function findMatches(request: CatalogRequest) {
    setBusyId(request.id);
    setError(null);
    setOk(null);
    try {
      const params = new URLSearchParams({
        q: request.requestedValue,
        type: request.requestedType,
        limit: "8",
      });
      const res = await fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not find catalog matches.");
      }
      setMatchesById((prev) => ({ ...prev, [request.id]: Array.isArray(data.suggestions) ? data.suggestions : [] }));
    } catch (e: any) {
      setError(e?.message || "Could not find catalog matches.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin - Catalog Requests</h1>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/admin" style={{ textDecoration: "underline" }}>Admin dashboard</Link>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)", background: "white", fontWeight: 800 }}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white" }}
        >
          <option value="PENDING">Pending</option>
          <option value="FULFILLED">Fulfilled</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>

      {error ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(255,0,0,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)" }}>{error}</div> : null}
      {ok ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(240,253,244,1)", color: "rgba(22,101,52,1)", fontWeight: 800 }}>{ok}</div> : null}
      {loading ? <div style={{ marginTop: 12, opacity: 0.8 }}>Loading requests...</div> : null}
      {isAdmin === false ? <div style={{ marginTop: 12, opacity: 0.85 }}>You are not authorized to view this page.</div> : null}

      {isAdmin ? (
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {requests.length === 0 && !loading ? <div style={{ opacity: 0.8 }}>No catalog requests found.</div> : null}
          {requests.map((request) => (
            <div key={request.id} style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)", background: "white", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 950 }}>{request.requestedValue}</div>
                  <div style={{ fontSize: 13, opacity: 0.72 }}>{request.requestedType} - {request.status} - {new Date(request.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 13, opacity: 0.78 }}>
                  <div>{request.user.firstName} {request.user.lastName}</div>
                  <div>{request.user.email}</div>
                </div>
              </div>

              {request.notes ? <div style={{ fontSize: 13 }}>User notes: {request.notes}</div> : null}
              {request.emailError ? <div style={{ fontSize: 13, color: "rgba(153,27,27,1)" }}>Admin email failed: {request.emailError}</div> : null}
              {request.resolvedCatalogEntity ? <div style={{ fontSize: 13 }}>Resolved to: {request.resolvedCatalogEntity.canonicalName} ({request.resolvedCatalogEntity.provider})</div> : null}

              {request.status === "PENDING" ? (
                <>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                    <input
                      value={entityIds[request.id] ?? ""}
                      onChange={(e) => setEntityIds((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      placeholder="Resolved CatalogEntity ID"
                      style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)" }}
                    />
                    <input
                      value={adminNotes[request.id] ?? ""}
                      onChange={(e) => setAdminNotes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      placeholder="Admin notes"
                      style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)" }}
                    />
                    <button
                      type="button"
                      onClick={() => findMatches(request)}
                      disabled={busyId === request.id}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.35)", background: "rgba(239,246,255,1)", fontWeight: 900 }}
                    >
                      Find matches
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewRequest(request.id, "FULFILLED")}
                      disabled={busyId === request.id}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(240,253,244,1)", fontWeight: 900 }}
                    >
                      Fulfill
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewRequest(request.id, "REJECTED")}
                      disabled={busyId === request.id}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(220,38,38,0.35)", background: "rgba(254,242,242,1)", fontWeight: 900 }}
                    >
                      Reject
                    </button>
                  </div>
                  {matchesById[request.id]?.length ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {matchesById[request.id].map((match) => (
                        <button
                          key={`${request.id}:${match.catalogEntityId ?? match.label}`}
                          type="button"
                          onClick={() => match.catalogEntityId && setEntityIds((prev) => ({ ...prev, [request.id]: match.catalogEntityId! }))}
                          style={{ textAlign: "left", padding: 10, borderRadius: 8, border: "1px solid rgba(148,163,184,0.5)", background: "rgba(248,250,252,1)" }}
                        >
                          <span style={{ display: "block", fontWeight: 900 }}>{match.label}</span>
                          <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                            {[match.catalogEntityId, match.subtitle, match.provider].filter(Boolean).join(" - ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
