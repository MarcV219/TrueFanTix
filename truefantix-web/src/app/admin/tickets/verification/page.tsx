"use client";

import React from "react";
import Link from "next/link";

type QueueTicket = {
  id: string;
  title: string;
  image: string;
  venue: string;
  date: string;
  priceCents: number;
  faceValueCents: number | null;
  status: string;
  verificationStatus: string;
  verificationScore: number | null;
  verificationReason: string | null;
  verificationProvider: string | null;
  verificationEvidence: string | null;
  verifiedAt: string | null;
  barcodeType: string | null;
  barcodeLast4: string | null;
  createdAt: string;
  seller?: { id: string; name: string; rating: number; reviews: number };
};

function money(cents: number) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export default function TicketVerificationAdminPage() {
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [status, setStatus] = React.useState("PENDING");
  const [tickets, setTickets] = React.useState<QueueTicket[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

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

      const res = await fetch(`/api/admin/tickets/verification-queue?status=${encodeURIComponent(status)}&take=100`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Failed to load queue");
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load queue.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function decide(ticketId: string, verificationStatus: "VERIFIED" | "REJECTED" | "NEEDS_REVIEW") {
    setBusyId(ticketId);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationStatus, verificationProvider: "admin-queue" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Update failed");
      await load();
    } catch (e: any) {
      setError(e?.message || "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Ticket Verification Queue</h1>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/account" style={{ textDecoration: "underline" }}>← Back to Account</Link>
          </div>
        </div>
        <button onClick={load} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)", background: "white", fontWeight: 800 }}>Refresh</button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["PENDING", "NEEDS_REVIEW", "REJECTED", "VERIFIED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: status === s ? "1px solid rgba(37,99,235,0.45)" : "1px solid rgba(0,0,0,0.1)",
              background: status === s ? "rgba(239,246,255,1)" : "white",
              fontWeight: 800,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(255,0,0,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)" }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12, opacity: 0.8 }}>Loading queue…</div> : null}
      {isAdmin === false ? <div style={{ marginTop: 12, opacity: 0.85 }}>You are not authorized to view this page.</div> : null}

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {tickets.map((t) => (
          <div key={t.id} style={{ border: "1px solid rgba(0,0,0,0.1)", background: "white", borderRadius: 12, padding: 12, display: "grid", gridTemplateColumns: "96px 1fr auto", gap: 12 }}>
            <img src={t.image} alt="" style={{ width: 96, height: 96, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(0,0,0,0.08)" }} />
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 900 }}>{t.title}</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{t.venue} • {t.date}</div>
              <div style={{ fontSize: 13 }}>
                {money(t.priceCents)}{t.faceValueCents != null ? ` (Face ${money(t.faceValueCents)})` : ""}
              </div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>
                Seller: {t.seller?.name || "—"} • Rating {typeof t.seller?.rating === "number" ? t.seller.rating.toFixed(1) : "—"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>
                Auto: {t.verificationStatus}{typeof t.verificationScore === "number" ? ` (${t.verificationScore})` : ""} • {t.verificationProvider || "—"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>
                Barcode: {t.barcodeType || "—"}{t.barcodeLast4 ? ` • ****${t.barcodeLast4}` : ""}
              </div>
              {t.verificationReason ? <div style={{ fontSize: 12, opacity: 0.78 }}>Reason: {t.verificationReason}</div> : null}
            </div>
            <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <button disabled={busyId === t.id} onClick={() => decide(t.id, "VERIFIED")} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(240,253,244,1)", fontWeight: 800 }}>Approve</button>
              <button disabled={busyId === t.id} onClick={() => decide(t.id, "NEEDS_REVIEW")} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(255,251,235,1)", fontWeight: 800 }}>Needs Review</button>
              <button disabled={busyId === t.id} onClick={() => decide(t.id, "REJECTED")} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(254,242,242,1)", fontWeight: 800 }}>Reject</button>
            </div>
          </div>
        ))}

        {!loading && tickets.length === 0 ? (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)", background: "white", opacity: 0.85 }}>
            No tickets in this queue.
          </div>
        ) : null}
      </div>
    </div>
  );
}
