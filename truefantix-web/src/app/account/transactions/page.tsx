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

function Body() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [balance, setBalance] = React.useState(0);
  const [transactions, setTransactions] = React.useState<AccessTokenTxn[]>([]);

  React.useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/account/access-tokens", { cache: "no-store" });
        const data = (await res.json()) as AccessTokenResponse;

        if (!alive) return;

        if (!res.ok || !data?.ok) {
          setError(data?.message || data?.error || "Failed to load transaction history.");
          return;
        }

        setBalance(Number(data.accessTokenBalance ?? 0));
        setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
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
