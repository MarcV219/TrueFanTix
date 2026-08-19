"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

type AdminUser = {
  id: string;
  createdAt: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: string;
  canBuy: boolean;
  canComment: boolean;
  canSell: boolean;
  isBanned: boolean;
  banReason: string | null;
  city: string;
  region: string;
  country: string;
  isVerified: boolean;
  seller: null | {
    id: string;
    name: string;
    status: string;
    stripeAccountId: string | null;
    stripeDetailsSubmitted: boolean;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
    payoutHold: boolean;
    payoutHoldReason: string | null;
    accessTokenBalance: number;
    payouts: Array<{
      id: string;
      amountCents: number;
      feeCents: number;
      netCents: number;
      status: string;
      provider: string | null;
      providerRef: string | null;
      createdAt: string;
      updatedAt: string;
      stripeTransferId: string | null;
      failureReason: string | null;
      attemptCount: number;
      lastAttemptAt: string | null;
      paidAt: string | null;
      orderId: string | null;
      order: null | {
        id: string;
        currency: string;
        createdAt: string;
        buyerConfirmationAt: string | null;
        items: Array<{ ticket: { id: string; title: string; venue: string; date: string; section: string | null; row: string | null; seat: string | null } }>;
      };
    }>;
  };
  _count: { sessions: number; notificationPreferences: number; forumPosts: number };
};

const FILTER_LABELS: Record<string, string> = {
  all: "Users & Sellers",
  sellers: "Sellers",
  "seller-stripe-attention": "Seller/Stripe Attention",
  "pending-payouts": "Pending Payouts",
};
const FILTER_DESCRIPTIONS: Record<string, string> = {
  all: "Search accounts, seller status, restrictions, and Stripe readiness.",
  sellers: "Showing accounts with seller profiles.",
  "seller-stripe-attention": "Showing sellers with pending approval or incomplete Stripe details, charges, or payouts.",
  "pending-payouts": "Showing sellers with pending payout records.",
};

function normalizeFilter(value: string) {
  return Object.keys(FILTER_LABELS).includes(value) ? value : "all";
}

function money(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

function seatLabel(ticket: { section: string | null; row: string | null; seat: string | null }) {
  return [ticket.section ? `Section ${ticket.section}` : null, ticket.row ? `Row ${ticket.row}` : null, ticket.seat ? `Seat ${ticket.seat}` : null].filter(Boolean).join(", ") || "General admission";
}

function AdminUsersContent() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";
  const initialFilter = normalizeFilter(params.get("filter") || "all");
  const [q, setQ] = React.useState(initialQ);
  const [filter, setFilter] = React.useState(initialFilter);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyPayoutId, setBusyPayoutId] = React.useState<string | null>(null);
  const liveSearchReady = React.useRef(false);

  const load = React.useCallback(async (query: string, nextFilter: string) => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({ q: query, filter: nextFilter, take: "50" });
      const res = await fetch(`/api/admin/users?${queryParams.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load users.");
      setUsers(Array.isArray(json.users) ? json.users : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setQ(initialQ);
    setFilter(initialFilter);
    load(initialQ, initialFilter);
  }, [initialQ, initialFilter, load]);

  React.useEffect(() => {
    if (!liveSearchReady.current) {
      liveSearchReady.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      load(q, filter);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [q, filter, load]);

  const title = FILTER_LABELS[filter] || FILTER_LABELS.all;
  const description = FILTER_DESCRIPTIONS[filter] || FILTER_DESCRIPTIONS.all;

  async function processPayout(payoutId: string) {
    if (!window.confirm("Release this payout to the seller's connected Stripe account? This sends funds and cannot be treated as a preview.")) return;
    setBusyPayoutId(payoutId); setError(null);
    try {
      const res = await apiFetch(`/api/admin/payouts/${encodeURIComponent(payoutId)}/process`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Payout failed.");
      await load(q, filter);
    } catch (err: any) { setError(err?.message || "Payout failed."); }
    finally { setBusyPayoutId(null); }
  }

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — {title}</h1>
          <div style={{ marginTop: 4, opacity: 0.72 }}>{description}</div>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Admin</Link>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(q, filter);
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
      >
        <select
          value={filter}
          onChange={(event) => {
            const nextFilter = event.target.value;
            setFilter(nextFilter);
          }}
          style={{ flex: "0 1 230px", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white" }}
        >
          <option value="all">All users</option>
          <option value="sellers">Sellers only</option>
          <option value="seller-stripe-attention">Seller/Stripe attention</option>
          <option value="pending-payouts">Pending payouts</option>
        </select>
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, email, phone, seller name"
          style={{ flex: "1 1 320px", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}
        />
        <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          Search
        </button>
        {q || filter !== "all" ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setFilter("all");
            }}
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading users...</div> : null}

      <div style={{ display: "grid", gap: 10 }}>
        {users.map((user) => (
          <section key={user.id} style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 950 }}>{user.firstName} {user.lastName}{user.displayName ? ` (${user.displayName})` : ""}</div>
                <div style={{ opacity: 0.78, fontSize: 13 }}>{user.email} | {user.phone}</div>
                <div style={{ opacity: 0.7, fontSize: 13 }}>{user.city}, {user.region}, {user.country} | Joined {new Date(user.createdAt).toLocaleDateString()}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div><strong>{user.role}</strong></div>
                <div>{user.isVerified ? "Verified" : "Not verified"}{user.isBanned ? " | Banned" : ""}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 12, fontSize: 13 }}>
              <div>Buy: <strong>{user.canBuy ? "Enabled" : "Disabled"}</strong></div>
              <div>Sell: <strong>{user.canSell ? "Enabled" : "Disabled"}</strong></div>
              <div>Comment: <strong>{user.canComment ? "Enabled" : "Disabled"}</strong></div>
              <div>Access Tokens: <strong>{user.seller?.accessTokenBalance ?? 0}</strong></div>
              <div>Forum comments: <strong>{user._count.forumPosts}</strong></div>
              <div>Sessions: <strong>{user._count.sessions}</strong></div>
              <div>Notification prefs: <strong>{user._count.notificationPreferences}</strong></div>
            </div>
            {user.seller ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                <strong>Seller:</strong> {user.seller.name} | {user.seller.status} | Stripe: {user.seller.stripeAccountId ? "linked" : "not linked"} | Charges {user.seller.stripeChargesEnabled ? "on" : "off"} | Payouts {user.seller.stripePayoutsEnabled ? "on" : "off"}
                {user.seller.payoutHold ? <div style={{ color: "rgba(153,27,27,1)" }}>Payout hold: {user.seller.payoutHoldReason || "No reason"}</div> : null}
              </div>
            ) : null}
            {filter === "pending-payouts" && user.seller?.payouts.length ? (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {user.seller.payouts.map((payout) => {
                  const currency = payout.order?.currency || "CAD";
                  return (
                    <div key={payout.id} style={{ padding: 12, borderRadius: 8, border: `1px solid ${payout.status === "FAILED" ? "rgba(239,68,68,.4)" : "rgba(217,119,6,.28)"}`, background: payout.status === "FAILED" ? "rgba(255,241,242,1)" : "rgba(255,251,235,1)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 950 }}>Payout {money(payout.netCents, currency)} — {payout.status}</div>
                          <div style={{ fontSize: 13, marginTop: 3 }}>
                            Order: {payout.orderId ? <Link href={`/admin/orders/${encodeURIComponent(payout.orderId)}`} style={{ fontWeight: 900, textDecoration: "underline" }}>{payout.orderId}</Link> : "Order unavailable"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: 13 }}>
                          <div><strong>Payout created:</strong> {new Date(payout.createdAt).toLocaleString()}</div>
                          <div><strong>Last updated:</strong> {new Date(payout.updatedAt).toLocaleString()}</div>
                          {payout.order?.buyerConfirmationAt ? <div><strong>Buyer confirmed:</strong> {new Date(payout.order.buyerConfirmationAt).toLocaleString()}</div> : null}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 10, fontSize: 13 }}>
                        <div><strong>Gross:</strong> {money(payout.amountCents, currency)}</div>
                        <div><strong>Payout fee:</strong> {money(payout.feeCents, currency)}</div>
                        <div><strong>Net payout:</strong> {money(payout.netCents, currency)}</div>
                        <div><strong>Method:</strong> {payout.provider === "ESCROW_INTERNAL" ? "TrueFanTix escrow" : payout.provider || "Not assigned"}</div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <strong style={{ fontSize: 13 }}>Tickets ({payout.order?.items.length || 0})</strong>
                        {payout.order?.items.length ? payout.order.items.map(({ ticket }) => (
                          <div key={ticket.id} style={{ marginTop: 5, padding: 8, borderRadius: 7, background: "white", fontSize: 13 }}>
                            <strong>{ticket.title}</strong> — {ticket.venue} — {ticket.date}<br />
                            {seatLabel(ticket)}
                          </div>
                        )) : <div style={{ marginTop: 5, fontSize: 13, opacity: .72 }}>No linked order details are available for this payout.</div>}
                      </div>
                      {payout.failureReason ? <div role="alert" style={{ marginTop: 10, padding: 9, borderRadius: 7, background: "white", color: "#991b1b", fontSize: 13 }}><strong>Last failure:</strong> {payout.failureReason}</div> : null}
                      <button
                        type="button"
                        onClick={() => processPayout(payout.id)}
                        disabled={busyPayoutId === payout.id}
                        style={{ marginTop: 10, padding: "9px 12px", border: 0, borderRadius: 8, background: payout.status === "FAILED" ? "#be123c" : "#064a93", color: "white", fontWeight: 900 }}
                      >
                        {busyPayoutId === payout.id ? "Processing…" : payout.status === "FAILED" ? "Retry Stripe payout" : "Review and release payout"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {user.banReason ? <div style={{ marginTop: 8, color: "rgba(153,27,27,1)", fontSize: 13 }}>Ban reason: {user.banReason}</div> : null}
          </section>
        ))}
        {!loading && users.length === 0 ? <div style={{ opacity: 0.75 }}>No users found.</div> : null}
      </div>
    </main>
  );
}

export default function AdminUsersPage() {
  return (
    <React.Suspense fallback={<main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>Loading users...</main>}>
      <AdminUsersContent />
    </React.Suspense>
  );
}
