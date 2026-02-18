"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type DashboardResponse = {
  ok: boolean;
  seller?: {
    id: string;
    name: string;
    rating: number;
    reviews: number;
    badges: string[];
    creditBalanceCredits: number;
    createdAt: string;
    updatedAt: string;
  };
  summary?: {
    creditBalanceCredits: number;
    lifetimeSalesCents: number;
    lifetimeSales: number;
    lifetimeOrders: number;
    lifetimeTicketsSold: number;
    ticketsAvailable: number;
    ticketsSold: number;
    ticketsTotal: number;
  };
  recent?: {
    tickets: Array<any>;
    orders: Array<any>;
    credits: Array<any>;
    payouts: Array<any>;
  };
  error?: string;
};

type PurchasesResponse = {
  ok: boolean;
  buyerSellerId: string;
  purchases: Array<{
    id: string;
    ticketId: string;
    sellerId: string;
    amountCents: number;
    adminFeeCents: number;
    totalCents: number;
    createdAt: string;
    ticket?: {
      id: string;
      title: string;
      date: string;
      venue: string;
      priceCents: number;
      status: string;
      event?: { selloutStatus: "SOLD_OUT" | "NOT_SOLD_OUT" };
    };
    seller?: { id: string; name: string };
  }>;
  error?: string;
};

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

export default function SellerPage() {
  const params = useParams<{ id?: string }>();
  const sellerId = React.useMemo(() => normalizeId(params?.id), [params?.id]);

  const dashboardUrl = React.useMemo(() => {
    if (!sellerId) return null;
    return `/api/sellers/${encodeURIComponent(sellerId)}/dashboard`;
  }, [sellerId]);

  const purchasesUrl = React.useMemo(() => {
    if (!sellerId) return null;
    return `/api/sellers/${encodeURIComponent(sellerId)}/purchases`;
  }, [sellerId]);

  const [dash, setDash] = React.useState<DashboardResponse | null>(null);
  const [purchases, setPurchases] = React.useState<PurchasesResponse | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [includeSold, setIncludeSold] = React.useState(true);

  React.useEffect(() => {
    let alive = true;

    async function run() {
      if (!dashboardUrl) {
        setLoading(false);
        setError("Missing seller id in URL.");
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const [dashRes, purchasesRes] = await Promise.all([
          fetch(dashboardUrl, { cache: "no-store" }),
          purchasesUrl ? fetch(purchasesUrl, { cache: "no-store" }) : Promise.resolve(null as any),
        ]);

        // Dashboard
        const dashText = await dashRes.text();
        let dashJson: any;
        try {
          dashJson = JSON.parse(dashText);
        } catch {
          throw new Error(`Non-JSON response from ${dashboardUrl}. Status: ${dashRes.status}`);
        }
        if (!dashRes.ok || !dashJson?.ok) {
          throw new Error(dashJson?.error || `Failed to load dashboard. Status: ${dashRes.status}`);
        }

        // Purchases (optional section)
        let purchasesJson: any = null;
        if (purchasesRes) {
          const pText = await purchasesRes.text();
          try {
            purchasesJson = JSON.parse(pText);
          } catch {
            purchasesJson = { ok: false, error: `Non-JSON response from ${purchasesUrl}.` };
          }
        }

        if (!alive) return;
        setDash(dashJson as DashboardResponse);
        setPurchases(purchasesJson as PurchasesResponse);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Unknown error");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [dashboardUrl, purchasesUrl]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="text-gray-700">Loading dashboard…</div>
          <div className="text-gray-500 text-xs mt-2">id: {sellerId || "—"}</div>
        </div>
      </div>
    );
  }

  if (error || !dash) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="text-red-600 font-semibold mb-2">Seller Page Error</div>
          <div className="text-gray-700">{error ?? "No data"}</div>

          <div className="mt-5 flex gap-3">
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <Link className="text-blue-600 underline py-2" href="/">
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { seller, summary, recent } = dash;

  if (!seller || !summary || !recent) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="text-red-600 font-semibold mb-2">Seller Page Error</div>
          <div className="text-gray-700">Dashboard response missing expected fields.</div>
        </div>
      </div>
    );
  }

  const filteredTickets = includeSold
    ? recent.tickets
    : (recent.tickets ?? []).filter((t: any) => t.status === "AVAILABLE");

  const purchaseList = purchases?.ok ? purchases.purchases : [];

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-blue-600">{seller.name}</h1>
              <div className="text-gray-600">
                Rating {seller.rating.toFixed(1)} • {seller.reviews} reviews
              </div>
              <div className="flex gap-2 flex-wrap mt-2">
                {seller.badges.map((b) => (
                  <span
                    key={b}
                    className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-semibold"
                  >
                    {b}
                  </span>
                ))}
              </div>
              <div className="text-gray-400 text-xs mt-2">id: {seller.id}</div>
            </div>

            {/* Credits (units) */}
            <div className="text-right">
              <div className="text-gray-500 text-sm">Credits</div>
              <div className="text-3xl font-bold text-green-600">
                {summary.creditBalanceCredits}
              </div>
              <div className="text-gray-500 text-xs">ticket credits (not dollars)</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-gray-500 text-sm">Lifetime sales</div>
            <div className="text-2xl font-bold">{fmtMoney(summary.lifetimeSales)}</div>
            <div className="text-gray-500 text-sm mt-1">
              {summary.lifetimeOrders} orders • {summary.lifetimeTicketsSold} tickets sold
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-gray-500 text-sm">Tickets</div>
            <div className="text-2xl font-bold">{summary.ticketsTotal}</div>
            <div className="text-gray-500 text-sm mt-1">
              {summary.ticketsAvailable} available • {summary.ticketsSold} sold
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-gray-500 text-sm mb-2">Ticket visibility</div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={includeSold}
                onChange={(e) => setIncludeSold(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-gray-700 text-sm">Include SOLD tickets</span>
            </label>
            <div className="mt-3 text-gray-500 text-xs">Homepage hides SOLD; seller view can show them.</div>
          </div>
        </div>

        {/* Recent tickets */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-blue-600 mb-4">Recent tickets (as seller)</h2>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Price</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Venue</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((t: any) => (
                  <tr key={t.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 font-medium">{t.title}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`text-xs px-2 py-1 rounded font-semibold ${
                          t.status === "SOLD"
                            ? "bg-gray-100 text-gray-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{fmtMoney(Number(t.price ?? 0))}</td>
                    <td className="py-2 pr-3">{t.date}</td>
                    <td className="py-2 pr-3">{t.venue}</td>
                  </tr>
                ))}
                {filteredTickets.length === 0 && (
                  <tr>
                    <td className="py-4 text-gray-600" colSpan={5}>
                      No tickets to display.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent purchases */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-xl font-bold text-blue-600 mb-4">Recent purchases (as buyer)</h2>

          {!purchasesUrl && (
            <div className="text-gray-600 text-sm">Missing buyer id.</div>
          )}

          {purchases && !purchases.ok && (
            <div className="text-gray-600 text-sm">
              Purchases endpoint not ready yet (that’s okay). Once added, this section will populate.
            </div>
          )}

          {purchases?.ok && purchaseList.length === 0 && (
            <div className="text-gray-600 text-sm">No purchases yet.</div>
          )}

          {purchases?.ok && purchaseList.length > 0 && (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-3">Ticket</th>
                    <th className="py-2 pr-3">Event sold out?</th>
                    <th className="py-2 pr-3">Total</th>
                    <th className="py-2 pr-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseList.map((o) => (
                    <tr key={o.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-medium">{o.ticket?.title ?? o.ticketId}</td>
                      <td className="py-2 pr-3">
                        <span className="text-xs px-2 py-1 rounded font-semibold bg-blue-50 text-blue-800">
                          {o.ticket?.event?.selloutStatus === "SOLD_OUT" ? "SOLD_OUT" : "NOT_SOLD_OUT"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{fmtMoney(o.totalCents / 100)}</td>
                      <td className="py-2 pr-3">
                        {new Date(o.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="text-sm text-gray-500 text-center">
          <Link className="text-blue-600 underline" href="/">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
