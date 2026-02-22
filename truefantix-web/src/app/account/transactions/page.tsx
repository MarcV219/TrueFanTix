"use client";

import React from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";

type AccessTokenTxn = {
  id: string;
  type: string;
  source: string | null;
  amountCredits: number;
  balanceAfterCredits: number | null;
  note: string | null;
  createdAt: string;
};

type AccessTokenResponse = {
  ok: boolean;
  accessTokenBalance: number;
  transactions: AccessTokenTxn[];
  error?: string;
  message?: string;
};

type TxnTab = "all" | "accessTokens" | "purchases" | "sales" | "payouts" | "refunds";

type PurchaseItem = {
  id: string;
  title: string;
  venue: string;
  date: string;
  price: number;
  status: string;
  orderId: string;
  orderDate: string;
};

type PurchasesResponse = {
  ok: boolean;
  tickets?: PurchaseItem[];
  error?: string;
  message?: string;
};

type SaleItem = {
  id: string;
  orderId: string;
  orderStatus: string;
  createdAt: string;
  ticketId: string;
  ticketTitle: string;
  venue: string;
  date: string;
  amount: number;
  adminFee: number;
  total: number;
};

type SalesResponse = {
  ok: boolean;
  sales?: SaleItem[];
  error?: string;
  message?: string;
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>{title}</h1>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/account" style={{ textDecoration: "underline" }}>
              ← Back to Account
            </Link>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/" style={{ textDecoration: "underline" }}>
            Home
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        border: active ? "1px solid rgba(37, 99, 235, 0.45)" : "1px solid rgba(0,0,0,0.1)",
        background: active ? "rgba(239, 246, 255, 1)" : "white",
        color: active ? "rgba(30, 64, 175, 1)" : "rgba(15, 23, 42, 1)",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function AccessTokenTable({ transactions }: { transactions: AccessTokenTxn[] }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        overflowX: "auto",
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 10 }}>Access token transaction history</div>

      {transactions.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No access token transactions yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
              <th style={{ padding: "8px 6px" }}>When</th>
              <th style={{ padding: "8px 6px" }}>Type</th>
              <th style={{ padding: "8px 6px" }}>Source</th>
              <th style={{ padding: "8px 6px" }}>Amount</th>
              <th style={{ padding: "8px 6px" }}>Balance After</th>
              <th style={{ padding: "8px 6px" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                  {new Date(t.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "8px 6px" }}>{t.type}</td>
                <td style={{ padding: "8px 6px" }}>{t.source || "—"}</td>
                <td
                  style={{
                    padding: "8px 6px",
                    fontWeight: 900,
                    color: t.amountCredits >= 0 ? "rgba(22,101,52,1)" : "rgba(153,27,27,1)",
                  }}
                >
                  {t.amountCredits >= 0 ? "+" : ""}
                  {t.amountCredits}
                </td>
                <td style={{ padding: "8px 6px" }}>{t.balanceAfterCredits ?? "—"}</td>
                <td style={{ padding: "8px 6px" }}>{t.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PurchasesTable({ purchases }: { purchases: PurchaseItem[] }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        overflowX: "auto",
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 10 }}>Purchase history</div>
      {purchases.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No purchases yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
              <th style={{ padding: "8px 6px" }}>When</th>
              <th style={{ padding: "8px 6px" }}>Ticket</th>
              <th style={{ padding: "8px 6px" }}>Venue</th>
              <th style={{ padding: "8px 6px" }}>Event Date</th>
              <th style={{ padding: "8px 6px" }}>Price</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px" }}>Order</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={`${p.orderId}-${p.id}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{new Date(p.orderDate).toLocaleString()}</td>
                <td style={{ padding: "8px 6px", fontWeight: 700 }}>{p.title}</td>
                <td style={{ padding: "8px 6px" }}>{p.venue}</td>
                <td style={{ padding: "8px 6px" }}>{p.date}</td>
                <td style={{ padding: "8px 6px" }}>${Number(p.price ?? 0).toFixed(2)}</td>
                <td style={{ padding: "8px 6px" }}>{p.status}</td>
                <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 12 }}>{p.orderId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SalesTable({ sales }: { sales: SaleItem[] }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        overflowX: "auto",
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 10 }}>Sales history</div>
      {sales.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No sales yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
              <th style={{ padding: "8px 6px" }}>When</th>
              <th style={{ padding: "8px 6px" }}>Ticket</th>
              <th style={{ padding: "8px 6px" }}>Venue</th>
              <th style={{ padding: "8px 6px" }}>Event Date</th>
              <th style={{ padding: "8px 6px" }}>Amount</th>
              <th style={{ padding: "8px 6px" }}>Fee</th>
              <th style={{ padding: "8px 6px" }}>Total</th>
              <th style={{ padding: "8px 6px" }}>Order Status</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={`${s.orderId}-${s.id}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{new Date(s.createdAt).toLocaleString()}</td>
                <td style={{ padding: "8px 6px", fontWeight: 700 }}>{s.ticketTitle}</td>
                <td style={{ padding: "8px 6px" }}>{s.venue}</td>
                <td style={{ padding: "8px 6px" }}>{s.date}</td>
                <td style={{ padding: "8px 6px" }}>${Number(s.amount ?? 0).toFixed(2)}</td>
                <td style={{ padding: "8px 6px" }}>${Number(s.adminFee ?? 0).toFixed(2)}</td>
                <td style={{ padding: "8px 6px" }}>${Number(s.total ?? 0).toFixed(2)}</td>
                <td style={{ padding: "8px 6px" }}>{s.orderStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
      }}
    >
      <div style={{ fontWeight: 900 }}>{label}</div>
      <div style={{ marginTop: 6, opacity: 0.8 }}>Coming next — this tab will be populated soon.</div>
    </div>
  );
}

function Body() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [balance, setBalance] = React.useState(0);
  const [transactions, setTransactions] = React.useState<AccessTokenTxn[]>([]);
  const [purchases, setPurchases] = React.useState<PurchaseItem[]>([]);
  const [sales, setSales] = React.useState<SaleItem[]>([]);
  const [tab, setTab] = React.useState<TxnTab>("all");

  React.useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [tokenRes, purchasesRes, salesRes] = await Promise.all([
          fetch("/api/account/access-tokens", { cache: "no-store" }),
          fetch("/api/account/tickets/bought", { cache: "no-store" }),
          fetch("/api/account/transactions/sales", { cache: "no-store" }),
        ]);

        const tokenData = (await tokenRes.json()) as AccessTokenResponse;
        const purchasesData = (await purchasesRes.json()) as PurchasesResponse;
        const salesData = (await salesRes.json()) as SalesResponse;

        if (!alive) return;

        if (!tokenRes.ok || !tokenData?.ok) {
          setError(tokenData?.message || tokenData?.error || "Failed to load transaction history.");
          return;
        }

        if (!purchasesRes.ok || !purchasesData?.ok) {
          setError(purchasesData?.message || purchasesData?.error || "Failed to load purchases.");
          return;
        }

        if (!salesRes.ok || !salesData?.ok) {
          setError(salesData?.message || salesData?.error || "Failed to load sales.");
          return;
        }

        setBalance(Number(tokenData.accessTokenBalance ?? 0));
        setTransactions(Array.isArray(tokenData.transactions) ? tokenData.transactions : []);
        setPurchases(Array.isArray(purchasesData.tickets) ? purchasesData.tickets : []);
        setSales(Array.isArray(salesData.sales) ? salesData.sales : []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load transaction history.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 14, borderRadius: 12, border: "1px solid rgba(0,0,0,0.10)", background: "white" }}>
        Loading transaction history…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        style={{
          padding: 12,
          borderRadius: 10,
          border: "1px solid rgba(255,0,0,0.35)",
          background: "rgba(254, 242, 242, 1)",
          color: "rgba(153, 27, 27, 1)",
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "white",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7 }}>Current access token balance</div>
        <div style={{ fontSize: 30, fontWeight: 950, color: "rgba(22,101,52,1)" }}>{balance}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <TabButton active={tab === "all"} label="All" onClick={() => setTab("all")} />
        <TabButton active={tab === "accessTokens"} label="Access Tokens" onClick={() => setTab("accessTokens")} />
        <TabButton active={tab === "purchases"} label="Purchases" onClick={() => setTab("purchases")} />
        <TabButton active={tab === "sales"} label="Sales" onClick={() => setTab("sales")} />
        <TabButton active={tab === "payouts"} label="Payouts" onClick={() => setTab("payouts")} />
        <TabButton active={tab === "refunds"} label="Refunds" onClick={() => setTab("refunds")} />
      </div>

      {tab === "all" && (
        <>
          <AccessTokenTable transactions={transactions} />
          <PurchasesTable purchases={purchases} />
          <SalesTable sales={sales} />
          <ComingSoon label="Payouts" />
          <ComingSoon label="Refunds" />
        </>
      )}

      {tab === "accessTokens" && <AccessTokenTable transactions={transactions} />}
      {tab === "purchases" && <PurchasesTable purchases={purchases} />}
      {tab === "sales" && <SalesTable sales={sales} />}
      {tab === "payouts" && <ComingSoon label="Payouts" />}
      {tab === "refunds" && <ComingSoon label="Refunds" />}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Shell title="Transaction history">
      <AccountGate
        nextPath="/account/transactions"
        loadingFallback={<p style={{ opacity: 0.8 }}>Loading…</p>}
        errorFallback={(message) => (
          <div
            role="alert"
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,0,0,0.35)",
              background: "rgba(254, 242, 242, 1)",
              color: "rgba(153, 27, 27, 1)",
            }}
          >
            {message}
          </div>
        )}
      >
        {() => <Body />}
      </AccountGate>
    </Shell>
  );
}
