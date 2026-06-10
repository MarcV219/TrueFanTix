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
  type?: string;
  catalogEntityId?: string;
  label: string;
  provider?: string;
  subtitle?: string;
};

type ReviewStatus = "FULFILLED" | "REJECTED" | "NEEDS_CLARIFICATION";
type RequestMessage = {
  tone: "success" | "warning" | "error";
  text: string;
};

export default function CatalogRequestsAdminPage() {
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [status, setStatus] = React.useState("PENDING");
  const [requests, setRequests] = React.useState<CatalogRequest[]>([]);
  const [entityIds, setEntityIds] = React.useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = React.useState<Record<string, string>>({});
  const [clarificationOpen, setClarificationOpen] = React.useState<Record<string, boolean>>({});
  const [matchesById, setMatchesById] = React.useState<Record<string, CatalogSuggestion[]>>({});
  const [searchQueries, setSearchQueries] = React.useState<Record<string, string>>({});
  const [searchTypes, setSearchTypes] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [requestMessages, setRequestMessages] = React.useState<Record<string, RequestMessage>>({});

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
      const nextRequests = Array.isArray(data.requests) ? data.requests : [];
      setRequests(nextRequests);
      setRequestMessages((prev) => {
        const visibleIds = new Set(nextRequests.map((request: CatalogRequest) => request.id));
        return Object.fromEntries(Object.entries(prev).filter(([id]) => visibleIds.has(id)));
      });
    } catch (e: any) {
      setError(e?.message || "Could not load catalog requests.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    load();
  }, [load]);

  function defaultSearchType(request: CatalogRequest) {
    return request.requestedType === "VENUE" ? "ALL" : request.requestedType;
  }

  function setRequestMessage(id: string, message: RequestMessage) {
    setRequestMessages((prev) => ({ ...prev, [id]: message }));
  }

  async function reviewRequest(id: string, nextStatus: ReviewStatus, catalogEntityId?: string) {
    setBusyId(id);
    setError(null);
    setRequestMessages((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const note = adminNotes[id]?.trim() || null;
      const { res, data } = await fetchJson(`/api/admin/catalog-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          catalogEntityId: nextStatus === "FULFILLED" ? (catalogEntityId || entityIds[id]?.trim()) : null,
          adminNotes: note,
        }),
      });

      if (!res.ok || !data?.ok) {
        const details = Array.isArray(data?.details) ? data.details : null;
        throw new Error(details?.[0] || data?.message || data?.error || "Could not update catalog request.");
      }

      setRequestMessage(id, {
        tone: nextStatus === "NEEDS_CLARIFICATION" && data?.emailSent === false ? "warning" : "success",
        text:
          nextStatus === "FULFILLED"
            ? "Request fulfilled and favorite added."
            : nextStatus === "NEEDS_CLARIFICATION"
              ? data?.emailSent === false
                ? "Clarification saved, but the email could not be sent."
                : "Clarification requested from the user."
              : "Request rejected.",
      });
      await load();
    } catch (e: any) {
      setRequestMessage(id, { tone: "error", text: e?.message || "Could not update catalog request." });
    } finally {
      setBusyId(null);
    }
  }

  function openClarification(request: CatalogRequest) {
    setError(null);
    setClarificationOpen((prev) => ({ ...prev, [request.id]: true }));
    setAdminNotes((prev) => {
      if (prev[request.id] !== undefined) {
        return prev;
      }

      return { ...prev, [request.id]: request.adminNotes || "" };
    });
  }

  async function sendClarification(request: CatalogRequest) {
    const question = adminNotes[request.id]?.trim();
    if (!question) {
      setError(null);
      setRequestMessage(request.id, { tone: "error", text: "Enter the question you want to send to the user." });
      setClarificationOpen((prev) => ({ ...prev, [request.id]: true }));
      return;
    }

    await reviewRequest(request.id, "NEEDS_CLARIFICATION");
  }

  async function findMatches(request: CatalogRequest) {
    setBusyId(request.id);
    setError(null);
    setRequestMessages((prev) => {
      const next = { ...prev };
      delete next[request.id];
      return next;
    });
    try {
      const query = (searchQueries[request.id] || request.requestedValue).trim();
      const type = (searchTypes[request.id] || defaultSearchType(request)).trim();
      const params = new URLSearchParams({
        q: query,
        type,
        limit: "12",
      });
      const res = await fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not find catalog matches.");
      }
      setMatchesById((prev) => ({ ...prev, [request.id]: Array.isArray(data.suggestions) ? data.suggestions : [] }));
      if (!Array.isArray(data.suggestions) || data.suggestions.length === 0) {
        setRequestMessage(request.id, { tone: "warning", text: "No matches found. Add a clarification question if the request is ambiguous." });
        openClarification(request);
      }
    } catch (e: any) {
      setRequestMessage(request.id, { tone: "error", text: e?.message || "Could not find catalog matches." });
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
            <Link href="/admin" style={{ textDecoration: "underline" }}>Back to Admin</Link>
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
          <option value="NEEDS_CLARIFICATION">Needs clarification</option>
          <option value="FULFILLED">Fulfilled</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>

      {error ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(255,0,0,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)" }}>{error}</div> : null}
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
              {requestMessages[request.id] ? (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border:
                      requestMessages[request.id].tone === "error"
                        ? "1px solid rgba(220,38,38,0.35)"
                        : requestMessages[request.id].tone === "warning"
                          ? "1px solid rgba(245,158,11,0.35)"
                          : "1px solid rgba(34,197,94,0.35)",
                    background:
                      requestMessages[request.id].tone === "error"
                        ? "rgba(254,242,242,1)"
                        : requestMessages[request.id].tone === "warning"
                          ? "rgba(255,251,235,1)"
                          : "rgba(240,253,244,1)",
                    color:
                      requestMessages[request.id].tone === "error"
                        ? "rgba(153,27,27,1)"
                        : requestMessages[request.id].tone === "warning"
                          ? "rgba(146,64,14,1)"
                          : "rgba(22,101,52,1)",
                    fontWeight: 800,
                  }}
                >
                  {requestMessages[request.id].text}
                </div>
              ) : null}

              {request.status === "PENDING" || request.status === "NEEDS_CLARIFICATION" ? (
                <>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                    <input
                      value={entityIds[request.id] ?? ""}
                      onChange={(e) => setEntityIds((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      placeholder="Resolved CatalogEntity ID"
                      style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)" }}
                    />
                    <input
                      value={searchQueries[request.id] ?? request.requestedValue}
                      onChange={(e) => setSearchQueries((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      placeholder="Search term"
                      style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)" }}
                    />
                    <select
                      value={searchTypes[request.id] ?? defaultSearchType(request)}
                      onChange={(e) => setSearchTypes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white" }}
                    >
                      <option value="ALL">All types</option>
                      <option value="ARTIST">Artist</option>
                      <option value="TEAM">Team</option>
                      <option value="VENUE">Venue</option>
                      <option value="CITY">City / town</option>
                      <option value="SPORT">Sport</option>
                    </select>
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
                    <button
                      type="button"
                      onClick={() => openClarification(request)}
                      disabled={busyId === request.id}
                      style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.45)", background: "rgba(255,251,235,1)", fontWeight: 900 }}
                    >
                      Ask user
                    </button>
                  </div>
                  {clarificationOpen[request.id] ? (
                    <div style={{ display: "grid", gap: 8, padding: 10, borderRadius: 8, border: "1px solid rgba(245,158,11,0.35)", background: "rgba(255,251,235,0.72)" }}>
                      <textarea
                        value={adminNotes[request.id] ?? request.adminNotes ?? ""}
                        onChange={(e) => setAdminNotes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                        placeholder="Question to send to the user"
                        rows={3}
                        style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", resize: "vertical" }}
                      />
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => setClarificationOpen((prev) => ({ ...prev, [request.id]: false }))}
                          disabled={busyId === request.id}
                          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "white", fontWeight: 800 }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => sendClarification(request)}
                          disabled={busyId === request.id}
                          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.45)", background: "rgba(255,251,235,1)", fontWeight: 900 }}
                        >
                          Send question
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {matchesById[request.id]?.length ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {matchesById[request.id].map((match) => (
                        <div
                          key={`${request.id}:${match.catalogEntityId ?? match.label}`}
                          style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto", alignItems: "center", padding: 10, borderRadius: 8, border: "1px solid rgba(148,163,184,0.5)", background: "rgba(248,250,252,1)" }}
                        >
                          <button
                            type="button"
                            onClick={() => match.catalogEntityId && setEntityIds((prev) => ({ ...prev, [request.id]: match.catalogEntityId! }))}
                            style={{ textAlign: "left", border: 0, background: "transparent", padding: 0, cursor: match.catalogEntityId ? "pointer" : "default" }}
                          >
                            <span style={{ display: "block", fontWeight: 900 }}>{match.label}</span>
                            <span style={{ display: "block", marginTop: 2, fontSize: 12, opacity: 0.72 }}>
                              {[match.type, match.catalogEntityId, match.subtitle, match.provider].filter(Boolean).join(" - ")}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => match.catalogEntityId && reviewRequest(request.id, "FULFILLED", match.catalogEntityId)}
                            disabled={busyId === request.id || !match.catalogEntityId}
                            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(240,253,244,1)", fontWeight: 900 }}
                          >
                            Add
                          </button>
                        </div>
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
