"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
  };
  _count: { sessions: number; notificationPreferences: number };
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

function AdminUsersContent() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";
  const initialFilter = normalizeFilter(params.get("filter") || "all");
  const [q, setQ] = React.useState(initialQ);
  const [filter, setFilter] = React.useState(initialFilter);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
              <div>Sessions: <strong>{user._count.sessions}</strong></div>
              <div>Notification prefs: <strong>{user._count.notificationPreferences}</strong></div>
            </div>
            {user.seller ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", fontSize: 13 }}>
                <strong>Seller:</strong> {user.seller.name} | {user.seller.status} | Stripe: {user.seller.stripeAccountId ? "linked" : "not linked"} | Charges {user.seller.stripeChargesEnabled ? "on" : "off"} | Payouts {user.seller.stripePayoutsEnabled ? "on" : "off"}
                {user.seller.payoutHold ? <div style={{ color: "rgba(153,27,27,1)" }}>Payout hold: {user.seller.payoutHoldReason || "No reason"}</div> : null}
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
