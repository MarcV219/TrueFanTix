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

type AttentionCounts = {
  pending: number;
  needsReview: number;
  rejected: number;
  catalogRequests: number;
  sellerStripe: number;
  suspendedSellers: number;
  expiredReservations: number;
  openEscrows: number;
  disputes: number;
  transferProofReviews: number;
  failedPayments: number;
  pendingPayouts: number;
  failedEmails: number;
  moderatedForumItems: number;
  actionable: number;
};

const ATTENTION_ITEMS: Array<{
  key: keyof AttentionCounts;
  label: string;
  description: string;
  href: string;
  urgent?: boolean;
}> = [
  { key: "pending", label: "Ticket verification pending", description: "New listings waiting for an approval decision.", href: "#ticket-verification" },
  { key: "needsReview", label: "Tickets needing review", description: "Listings flagged for manual investigation.", href: "#ticket-verification", urgent: true },
  { key: "disputes", label: "Open disputes", description: "Buyer disputes with seller payout paused.", href: "/admin/orders?status=DISPUTED", urgent: true },
  { key: "transferProofReviews", label: "Transfer proof human reviews", description: "Seller transfer documentation waiting for an Admin decision.", href: "/admin/orders?status=HUMAN_REVIEW", urgent: true },
  { key: "catalogRequests", label: "Catalog requests", description: "Requested artists, teams, venues, or cities to review.", href: "/admin/catalog-requests" },
  { key: "sellerStripe", label: "Seller / Stripe attention", description: "Seller approval or Stripe onboarding is incomplete.", href: "/admin/seller-attention" },
  { key: "suspendedSellers", label: "Suspended sellers", description: "Restricted seller accounts to monitor or review.", href: "/admin/reviewable-attention?queue=suspendedSellers" },
  { key: "expiredReservations", label: "Expired reservations", description: "Reserved tickets whose hold time has elapsed.", href: "/admin/reviewable-attention?queue=expiredReservations" },
  { key: "openEscrows", label: "Open payment holds", description: "Ticket access or funds remain in escrow.", href: "/admin/orders" },
  { key: "failedPayments", label: "Failed payments", description: "Payment attempts available for review.", href: "/admin/reviewable-attention?queue=failedPayments" },
  { key: "pendingPayouts", label: "Pending payouts", description: "Seller payouts waiting to be processed.", href: "/admin/users?filter=pending-payouts" },
  { key: "failedEmails", label: "Failed emails (24 hours)", description: "Recent email deliveries available for review.", href: "/admin/reviewable-attention?queue=failedEmails" },
  { key: "moderatedForumItems", label: "Moderated forum items", description: "Hidden or deleted threads and posts for oversight.", href: "/admin/reviewable-attention?queue=moderatedForumItems" },
];

function money(cents: number) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export default function TicketVerificationAdminPage() {
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [status, setStatus] = React.useState("PENDING");
  const [tickets, setTickets] = React.useState<QueueTicket[]>([]);
  const [counts, setCounts] = React.useState<AttentionCounts | null>(null);
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

      const [queueRes, countRes] = await Promise.all([
        fetch(`/api/admin/tickets/verification-queue?status=${encodeURIComponent(status)}&take=100`, {
          cache: "no-store",
        }),
        fetch("/api/admin/tickets/verification-count", { cache: "no-store" }),
      ]);
      const [queueData, countData] = await Promise.all([queueRes.json(), countRes.json()]);
      if (!queueRes.ok || !queueData?.ok) {
        const details = Array.isArray(queueData?.details) ? queueData.details : null;
        throw new Error(queueData?.message || queueData?.error || (details?.length ? details[0] : null) || "Failed to load queue");
      }
      if (!countRes.ok || !countData?.ok) {
        throw new Error(countData?.message || countData?.error || "Failed to load admin attention counts");
      }
      setTickets(Array.isArray(queueData.tickets) ? queueData.tickets : []);
      setCounts(countData.counts);
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
      if (!res.ok || !data?.ok) {
        const details = Array.isArray(data?.details) ? data.details : null;
        throw new Error(data?.message || data?.error || (details?.length ? details[0] : null) || "Update failed");
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  const canViewQueue = isAdmin === true;

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin Queue</h1>
          <div style={{ marginTop: 5, opacity: 0.75 }}>Everything currently requiring Admin attention in one place.</div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/admin" style={{ textDecoration: "underline" }}>← Back to Admin</Link>
          </div>
        </div>
        {canViewQueue ? (
          <button onClick={load} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)", background: "white", fontWeight: 800 }}>Refresh</button>
        ) : null}
      </div>

      {canViewQueue && counts ? (
        <section style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 21 }}>Needs attention</h2>
            <strong style={{ color: counts.actionable > 0 ? "rgba(180,83,9,1)" : "rgba(22,101,52,1)" }}>
              {counts.actionable} total
            </strong>
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))", gap: 10 }}>
            {ATTENTION_ITEMS.map((item) => {
              const value = Number(counts[item.key] || 0);
              const active = value > 0;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                    padding: 14,
                    borderRadius: 10,
                    border: active
                      ? `1px solid ${item.urgent ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.38)"}`
                      : "1px solid rgba(0,0,0,0.09)",
                    background: active
                      ? item.urgent ? "rgba(254,242,242,1)" : "rgba(255,251,235,1)"
                      : "rgba(248,250,252,1)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{item.label}</strong>
                    <span style={{ fontSize: 20, fontWeight: 950 }}>{value}</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 12, opacity: 0.72 }}>{item.description}</div>
                  <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800 }}>{active ? "Review now →" : "Open →"}</div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {canViewQueue ? (
        <section id="ticket-verification" style={{ marginTop: 24, scrollMarginTop: 100 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 21 }}>Ticket verification</h2>
          <div style={{ opacity: 0.72, fontSize: 13 }}>Review current listings or view previous decisions.</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
              {counts && s !== "VERIFIED"
                ? ` (${s === "PENDING" ? counts.pending : s === "NEEDS_REVIEW" ? counts.needsReview : counts.rejected})`
                : ""}
            </button>
          ))}
          </div>
        </section>
      ) : null}

      {error ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid rgba(255,0,0,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)" }}>{error}</div> : null}
      {loading ? <div style={{ marginTop: 12, opacity: 0.8 }}>Loading queue…</div> : null}
      {isAdmin === false ? <div style={{ marginTop: 12, opacity: 0.85 }}>You are not authorized to view this page.</div> : null}

      {canViewQueue ? <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
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
              <Link href={`/admin/tickets/${encodeURIComponent(t.id)}`} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.25)", background: "white", color: "inherit", textDecoration: "none", fontWeight: 800, textAlign: "center" }}>Details</Link>
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
      </div> : null}
    </div>
  );
}
