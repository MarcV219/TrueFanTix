"use client";

import React from "react";
import Link from "next/link";

type TaxReport = {
  ok: true;
  filters: { from: string | null; to: string | null; statuses: string[] };
  summary: {
    orderCount: number;
    ticketSubtotal: number;
    adminFee: number;
    adminFeeTax: number;
    total: number;
  };
  regions: Array<{
    taxCountryCode: string | null;
    taxRegionCode: string | null;
    taxRegionName: string | null;
    taxLabel: string | null;
    taxRateBps: number;
    orderCount: number;
    ticketSubtotal: number;
    adminFee: number;
    adminFeeTax: number;
    total: number;
  }>;
  configuredRates: Array<{
    countryCode: "CA" | "US";
    regionCode: string;
    regionName: string;
    rateBps: number;
    label: string;
    gstRateBps?: number;
    provincialTaxRateBps?: number;
    provincialTaxLabel?: "PST" | "RST" | "QST";
    hstRateBps?: number;
    totalRateBps?: number;
    collectionRateBps?: number;
    taxExempt?: boolean;
    taxExemptionReason?: string;
    orderCount: number;
    ticketSubtotal: number;
    adminFee: number;
    adminFeeTax: number;
    total: number;
  }>;
  orders: Array<{
    id: string;
    createdAt: string;
    status: string;
    ticketTitle: string;
    venue: string;
    taxCountryCode: string | null;
    taxRegionCode: string | null;
    taxLabel: string | null;
    taxRateBps: number;
    ticketSubtotal: number;
    adminFee: number;
    adminFeeTax: number;
    total: number;
  }>;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return isoDate(d);
}

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function rate(bps: number) {
  const percent = Number(bps || 0) / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  return `${percent.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function componentRate(bps?: number) {
  return typeof bps === "number" ? rate(bps) : "-";
}

function appliedRate(row: TaxReport["configuredRates"][number]) {
  const collectionRateBps = row.taxExempt ? 0 : row.collectionRateBps ?? row.totalRateBps ?? row.rateBps;
  return rate(collectionRateBps);
}

function buildQuery(from: string, to: string, format = "json") {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  qs.set("format", format);
  return qs.toString();
}

export default function AdminTaxReportPage() {
  const [from, setFrom] = React.useState(defaultFromDate);
  const [to, setTo] = React.useState(() => isoDate(new Date()));
  const [report, setReport] = React.useState<TaxReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/tax?${buildQuery(from, to)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load tax report.");
      setReport(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load tax report.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  React.useEffect(() => {
    load();
  }, [load]);

  const exportHref = `/api/admin/reports/tax?${buildQuery(from, to, "csv")}`;

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin — Admin Fee Tax Report</h1>
          <div style={{ marginTop: 4, opacity: 0.72 }}>
            Configured province/state rates with exemption status and collected admin-fee tax for the selected time frame.
          </div>
          <Link href="/admin" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Admin</Link>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 16 }}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 700 }}>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)" }} />
        </label>
        <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          Run Report
        </button>
        <a href={exportHref} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.30)", background: "rgba(239,246,255,1)", color: "rgba(30,64,175,1)", fontWeight: 800, textDecoration: "none" }}>
          Export CSV
        </a>
      </form>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading report...</div> : null}

      {report ? (
        <div style={{ display: "grid", gap: 18 }}>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              ["Orders", String(report.summary.orderCount)],
              ["Ticket subtotal", money(report.summary.ticketSubtotal)],
              ["Admin fees", money(report.summary.adminFee)],
              ["Tax on admin fees", money(report.summary.adminFeeTax)],
              ["Total paid", money(report.summary.total)],
            ].map(([label, value]) => (
              <div key={label} style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 950 }}>{value}</div>
              </div>
            ))}
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 950 }}>Configured Rates & Collected Tax</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
                    <th style={{ padding: 8 }}>Province / State</th>
                    <th style={{ padding: 8 }}>Country</th>
                    <th style={{ padding: 8 }}>GST</th>
                    <th style={{ padding: 8 }}>PST/RST/QST</th>
                    <th style={{ padding: 8 }}>HST</th>
                    <th style={{ padding: 8 }}>Statutory Total Rate</th>
                    <th style={{ padding: 8 }}>Total Rate to Apply</th>
                    <th style={{ padding: 8 }}>Tax Exemption</th>
                    <th style={{ padding: 8 }}>Exemption Reason</th>
                    <th style={{ padding: 8 }}>Orders</th>
                    <th style={{ padding: 8 }}>Admin Fees</th>
                    <th style={{ padding: 8 }}>Tax Collected</th>
                    <th style={{ padding: 8 }}>Total Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {report.configuredRates.map((row) => (
                    <tr key={`${row.countryCode}-${row.regionCode}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                      <td style={{ padding: 8 }}>{row.regionName} ({row.regionCode})</td>
                      <td style={{ padding: 8 }}>{row.countryCode}</td>
                      <td style={{ padding: 8 }}>{componentRate(row.gstRateBps)}</td>
                      <td style={{ padding: 8 }}>
                        {row.provincialTaxRateBps ? `${row.provincialTaxLabel || "PST"} ${rate(row.provincialTaxRateBps)}` : "-"}
                      </td>
                      <td style={{ padding: 8 }}>{componentRate(row.hstRateBps)}</td>
                      <td style={{ padding: 8 }}><strong>{row.label} {rate(row.totalRateBps ?? row.rateBps)}</strong></td>
                      <td style={{ padding: 8, fontWeight: 950 }}>{appliedRate(row)}</td>
                      <td style={{ padding: 8, fontWeight: 900 }}>{row.taxExempt ? "Yes" : "No"}</td>
                      <td style={{ padding: 8, minWidth: 260, opacity: row.taxExempt ? 0.86 : 0.55 }}>
                        {row.taxExemptionReason || "-"}
                      </td>
                      <td style={{ padding: 8 }}>{row.orderCount}</td>
                      <td style={{ padding: 8 }}>{money(row.adminFee)}</td>
                      <td style={{ padding: 8 }}>{money(row.adminFeeTax)}</td>
                      <td style={{ padding: 8 }}>{money(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 950 }}>By State / Province</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
                    <th style={{ padding: 8 }}>Region</th>
                    <th style={{ padding: 8 }}>Rate</th>
                    <th style={{ padding: 8 }}>Orders</th>
                    <th style={{ padding: 8 }}>Admin Fees</th>
                    <th style={{ padding: 8 }}>Tax</th>
                    <th style={{ padding: 8 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.regions.map((row) => (
                    <tr key={`${row.taxCountryCode}-${row.taxRegionCode}-${row.taxRateBps}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                      <td style={{ padding: 8 }}>{row.taxRegionCode || "Unresolved"} {row.taxCountryCode ? `(${row.taxCountryCode})` : ""}</td>
                      <td style={{ padding: 8 }}>{row.taxLabel || "Tax"} {rate(row.taxRateBps)}</td>
                      <td style={{ padding: 8 }}>{row.orderCount}</td>
                      <td style={{ padding: 8 }}>{money(row.adminFee)}</td>
                      <td style={{ padding: 8 }}>{money(row.adminFeeTax)}</td>
                      <td style={{ padding: 8 }}>{money(row.total)}</td>
                    </tr>
                  ))}
                  {report.regions.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 8, opacity: 0.75 }}>No paid orders in this range.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 950 }}>Recent Matching Orders</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {report.orders.slice(0, 25).map((order) => (
                <Link key={order.id} href={`/admin/orders?q=${encodeURIComponent(order.id)}`} style={{ color: "inherit", textDecoration: "none", padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{order.ticketTitle || order.id}</strong>
                    <span>{money(order.adminFeeTax)} tax on {money(order.adminFee)} admin fee</span>
                  </div>
                  <div style={{ opacity: 0.72, fontSize: 13 }}>
                    {new Date(order.createdAt).toLocaleDateString()} | {order.taxLabel || "Tax"} {rate(order.taxRateBps)} {order.taxRegionCode || ""} | {order.status}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
