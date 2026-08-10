"use client";

import React from "react";
import Link from "next/link";

type DashboardData = {
  ok: true;
  generatedAt: string;
  queues: Record<string, number>;
  activity: {
    newUsers24h: number;
    newTickets24h: number;
    ordersToday: number;
    salesToday: {
      ticketSubtotal: number;
      adminFees: number;
      adminFeeTax: number;
      total: number;
    };
  };
  recent: {
    orders: Array<{
      id: string;
      status: string;
      createdAt: string;
      amountCents: number;
      adminFeeCents: number;
      adminFeeTaxCents: number;
      totalCents: number;
      ticket: { title: string; venue: string; date: string } | null;
    }>;
    users: Array<{
      id: string;
      createdAt: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      canBuy: boolean;
      canSell: boolean;
      isBanned: boolean;
      isVerified: boolean;
    }>;
    auditLogs: Array<{
      id: string;
      createdAt: string;
      action: string;
      userId: string | null;
      targetType: string | null;
      targetId: string | null;
    }>;
  };
};

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function cents(centsValue: number) {
  return `$${(Number(centsValue || 0) / 100).toFixed(2)}`;
}

function Card({
  title,
  children,
  href,
}: {
  title: string;
  children: React.ReactNode;
  href?: string;
}) {
  const body = (
    <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
      <div style={{ fontWeight: 900, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : body;
}

function QueueItem({ label, value, href }: { label: string; value: number; href?: string }) {
  const urgent = value > 0;
  return (
    <Link
      href={href || "/admin"}
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 8,
        border: urgent ? "1px solid rgba(245,158,11,0.35)" : "1px solid rgba(0,0,0,0.08)",
        background: urgent ? "rgba(255,251,235,1)" : "rgba(248,250,252,1)",
      }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </Link>
  );
}

export default function AdminHomePage() {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load admin dashboard.");
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load admin dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950 }}>Admin</h1>
          <div style={{ opacity: 0.75, marginTop: 4 }}>Operations cockpit for marketplace safety, payments, and support.</div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "white", fontWeight: 800 }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {loading && !data ? <div style={{ opacity: 0.75 }}>Loading admin dashboard...</div> : null}

      {data ? (
        <div style={{ display: "grid", gap: 18 }}>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Card title="Today GMV"><div style={{ fontSize: 26, fontWeight: 950 }}>{money(data.activity.salesToday.total)}</div></Card>
            <Card title="Admin Fees"><div style={{ fontSize: 26, fontWeight: 950 }}>{money(data.activity.salesToday.adminFees)}</div></Card>
            <Card title="Tax On Fees"><div style={{ fontSize: 26, fontWeight: 950 }}>{money(data.activity.salesToday.adminFeeTax)}</div></Card>
            <Card title="Orders Today"><div style={{ fontSize: 26, fontWeight: 950 }}>{data.activity.ordersToday}</div></Card>
            <Card title="New Users 24h"><div style={{ fontSize: 26, fontWeight: 950 }}>{data.activity.newUsers24h}</div></Card>
            <Card title="New Tickets 24h"><div style={{ fontSize: 26, fontWeight: 950 }}>{data.activity.newTickets24h}</div></Card>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.1fr)", gap: 18 }}>
            <Card title="Queues">
              <div style={{ display: "grid", gap: 8 }}>
                <QueueItem label="Ticket verification pending" value={data.queues.pendingTicketVerification} href="/admin/tickets/verification" />
                <QueueItem label="Tickets needing review" value={data.queues.needsReviewTickets} href="/admin/tickets/verification" />
                <QueueItem label="Catalog requests" value={data.queues.pendingCatalogRequests} href="/admin/catalog-requests" />
                <QueueItem label="Seller/Stripe attention" value={data.queues.pendingSellerStripe} href="/admin/seller-attention" />
                <QueueItem label="Expired reservations" value={data.queues.expiredReservations} href="/admin/reviewable-attention?queue=expiredReservations" />
                <QueueItem label="Open payment holds" value={data.queues.openEscrows} href="/admin/orders" />
                <QueueItem label="Open disputes" value={data.queues.disputedOrders ?? 0} href="/admin/orders?status=DISPUTED" />
                <QueueItem label="Transfer proof human reviews" value={data.queues.transferProofReviews ?? 0} href="/admin/orders?status=HUMAN_REVIEW" />
                <QueueItem label="Failed payments" value={data.queues.failedPayments} href="/admin/reviewable-attention?queue=failedPayments" />
                <QueueItem label="Pending payouts" value={data.queues.pendingPayouts} href="/admin/users?filter=pending-payouts" />
                <QueueItem label="Failed emails 24h" value={data.queues.failedEmails} href="/admin/reviewable-attention?queue=failedEmails" />
                <QueueItem label="Moderated forum items" value={data.queues.moderatedForumItems} href="/admin/reviewable-attention?queue=moderatedForumItems" />
              </div>
            </Card>

            <Card title="Tools">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                <Card title="Users & Sellers" href="/admin/users"><div style={{ opacity: 0.75, fontSize: 13 }}>Search accounts, seller status, restrictions, Stripe readiness.</div></Card>
                <Card title="Orders" href="/admin/orders"><div style={{ opacity: 0.75, fontSize: 13 }}>Search payments, totals, tax, ticket details, and order state.</div></Card>
                <Card title="Listings" href="/admin/tickets"><div style={{ opacity: 0.75, fontSize: 13 }}>Search listings, sellers, seats, verification evidence, and uploaded receipts.</div></Card>
                <Card title="Tax Rates & Reports" href="/admin/reports/tax"><div style={{ opacity: 0.75, fontSize: 13 }}>Province/state rates and admin-fee tax collected by time frame.</div></Card>
                <Card title="Location Preflight" href="/admin/preflight/location-issues"><div style={{ opacity: 0.75, fontSize: 13 }}>Find listings and orders with unresolved state/province tax locations.</div></Card>
                <Card title="Audit Log" href="/admin/audit"><div style={{ opacity: 0.75, fontSize: 13 }}>Search security, user, order, and admin actions.</div></Card>
                <Card title="Ticket Verification" href="/admin/tickets/verification"><div style={{ opacity: 0.75, fontSize: 13 }}>Approve, reject, or review listings.</div></Card>
                <Card title="Catalog Requests" href="/admin/catalog-requests"><div style={{ opacity: 0.75, fontSize: 13 }}>Fulfill missing artists, teams, venues, and cities.</div></Card>
                <Card title="Early Access" href="/admin/early-access"><div style={{ opacity: 0.75, fontSize: 13 }}>Export waitlist leads.</div></Card>
              </div>
            </Card>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
            <Card title="Recent Orders">
              <div style={{ display: "grid", gap: 10 }}>
                {data.recent.orders.map((order) => (
                  <Link key={order.id} href={`/admin/orders?q=${encodeURIComponent(order.id)}`} style={{ color: "inherit", textDecoration: "none", borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{order.status}</strong>
                      <span>{cents(order.totalCents)}</span>
                    </div>
                    <div style={{ opacity: 0.75, fontSize: 13 }}>{order.ticket?.title || order.id}</div>
                    <div style={{ opacity: 0.65, fontSize: 12 }}>{new Date(order.createdAt).toLocaleString()}</div>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="Recent Users">
              <div style={{ display: "grid", gap: 10 }}>
                {data.recent.users.map((user) => (
                  <Link key={user.id} href={`/admin/users?q=${encodeURIComponent(user.email)}`} style={{ color: "inherit", textDecoration: "none", borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{user.firstName} {user.lastName}</strong>
                      <span>{user.role}</span>
                    </div>
                    <div style={{ opacity: 0.75, fontSize: 13 }}>{user.email}</div>
                    <div style={{ opacity: 0.65, fontSize: 12 }}>{user.isVerified ? "Verified" : "Not verified"}{user.isBanned ? " | Banned" : ""}</div>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="Recent Admin/Security Activity">
              <div style={{ display: "grid", gap: 10 }}>
                {data.recent.auditLogs.map((log) => (
                  <div key={log.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 8 }}>
                    <div style={{ fontWeight: 800 }}>{log.action}</div>
                    <div style={{ opacity: 0.75, fontSize: 13 }}>{log.targetType || "target"} {log.targetId || "-"}</div>
                    <div style={{ opacity: 0.65, fontSize: 12 }}>{new Date(log.createdAt).toLocaleString()}</div>
                  </div>
                ))}
                {data.recent.auditLogs.length === 0 ? <div style={{ opacity: 0.75 }}>No recent audit entries.</div> : null}
              </div>
            </Card>
          </section>
        </div>
      ) : null}
    </main>
  );
}
