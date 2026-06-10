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

function AdminUsersContent() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";
  const [q, setQ] = React.useState(initialQ);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (query = q) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}&take=50`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load users.");
      setUsers(Array.isArray(json.users) ? json.users : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [q]);

  React.useEffect(() => {
    load(initialQ);
  }, [initialQ, load]);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Users & Sellers</h1>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Admin</Link>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(q);
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
      >
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search name, email, phone, seller name"
          style={{ flex: "1 1 320px", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }}
        />
        <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          Search
        </button>
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
