"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";

type HoldingTicket = {
  id: string;
  title: string;
  venue: string;
  date: string;
  price: number;
  image: string;
  status: string;
  orderStatus: string;
  transferVerificationStatus: string | null;
  buyerConfirmationStatus: string | null;
  buyerConfirmationDeadline: string | null;
  orderId: string;
  orderDate: string;
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
        <Link href="/" style={{ textDecoration: "underline" }}>
          Home
        </Link>
      </div>

      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}

function fulfillmentLabel(ticket: HoldingTicket) {
  if (ticket.orderStatus === "PAID" && ticket.transferVerificationStatus === "PENDING") return "Confirm receipt";
  if (ticket.orderStatus === "PAID") return "Awaiting seller transfer";
  if (ticket.orderStatus === "DELIVERED" && ticket.buyerConfirmationStatus === "CONFIRMED") return "Transfer confirmed";
  if (ticket.orderStatus === "DELIVERED") return "Transferred - awaiting final completion";
  return ticket.orderStatus;
}

function TicketCard({ ticket, onConfirmed }: { ticket: HoldingTicket; onConfirmed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canConfirm =
    ticket.orderStatus === "PAID" &&
    ticket.transferVerificationStatus === "PENDING" &&
    ticket.buyerConfirmationStatus === "PENDING";

  async function confirmReceipt() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/confirm-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ticket.orderId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not confirm ticket receipt.");
      }
      onConfirmed();
    } catch (err: any) {
      setError(err.message || "Could not confirm ticket receipt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {ticket.image ? (
          <img
            src={ticket.image}
            alt={ticket.title}
            style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 8 }}
          />
        ) : null}
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{ticket.title}</h3>
          <p style={{ margin: "4px 0", opacity: 0.72 }}>{ticket.venue}</p>
          <p style={{ margin: "4px 0", opacity: 0.62, fontSize: 14 }}>{ticket.date}</p>
          <p style={{ margin: "8px 0 0", fontWeight: 800, color: "rgba(6, 74, 147, 1)" }}>
            ${ticket.price.toFixed(2)}
          </p>
        </div>
        <div style={{ display: "grid", gap: 8, alignContent: "center", minWidth: 180 }}>
          <span
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 900,
              background: "rgba(219, 234, 254, 1)",
              color: "rgba(30, 64, 175, 1)",
              textAlign: "center",
            }}
          >
            {fulfillmentLabel(ticket)}
          </span>
          <span
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 900,
              background: "rgba(240, 253, 244, 1)",
              color: "rgba(22, 101, 52, 1)",
              textAlign: "center",
            }}
          >
            Payment protected until delivery
          </span>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.62, textAlign: "center" }}>
            Purchased {new Date(ticket.orderDate).toLocaleDateString()}
          </p>
          {ticket.buyerConfirmationDeadline ? (
            <p style={{ margin: 0, fontSize: 12, opacity: 0.72, textAlign: "center" }}>
              Confirm by {new Date(ticket.buyerConfirmationDeadline).toLocaleString()}
            </p>
          ) : null}
          {canConfirm ? (
            <button
              type="button"
              onClick={confirmReceipt}
              disabled={busy}
              style={{
                minHeight: 38,
                border: 0,
                borderRadius: 8,
                background: "rgba(6, 74, 147, 1)",
                color: "white",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {busy ? "Confirming..." : "Confirm received"}
            </button>
          ) : null}
          {error ? (
            <div
              role="alert"
              style={{
                padding: 8,
                borderRadius: 8,
                background: "rgba(254, 242, 242, 1)",
                color: "rgba(153, 27, 27, 1)",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Body() {
  const [tickets, setTickets] = useState<HoldingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTickets() {
      try {
        const res = await fetch("/api/account/tickets/holding", { cache: "no-store" });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || "Failed to load holding tickets");
        }

        setTickets(data.tickets || []);
      } catch (err: any) {
        setError(err.message || "Failed to load holding tickets");
      } finally {
        setLoading(false);
      }
    }

    fetchTickets();
  }, []);

  async function refetchTickets() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/tickets/holding", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to load holding tickets");
      }
      setTickets(data.tickets || []);
    } catch (err: any) {
      setError(err.message || "Failed to load holding tickets");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ opacity: 0.7 }}>Loading holding tickets...</div>
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

  if (!tickets.length) {
    return (
      <div
        style={{
          padding: 40,
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "white",
          textAlign: "center",
        }}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>No holding tickets</h3>
        <p style={{ margin: 0, opacity: 0.7 }}>
          Tickets you have paid for will appear here until transfer and receipt are confirmed.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        {tickets.length} ticket{tickets.length !== 1 ? "s" : ""} pending transfer or final completion.
      </p>
      {tickets.map((ticket) => (
        <TicketCard key={`${ticket.orderId}-${ticket.id}`} ticket={ticket} onConfirmed={refetchTickets} />
      ))}
    </div>
  );
}

export default function HoldingTicketsPage() {
  return (
    <Shell title="Tickets — Holding">
      <AccountGate
        nextPath="/account/tickets/holding"
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
