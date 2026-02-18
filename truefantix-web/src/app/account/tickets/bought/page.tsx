"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";

type Ticket = {
  id: string;
  title: string;
  venue: string;
  date: string;
  price: number;
  image: string;
  status: string;
  orderId: string;
  orderDate: string;
  qrCodeUrl: string;
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

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [showQR, setShowQR] = useState(false);

  const handleDownloadQR = async () => {
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/qr`);
      if (!response.ok) {
        throw new Error("Failed to download QR code");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ticket-${ticket.id}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert("Failed to download QR code. Please try again.");
    }
  };

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
        {ticket.image && (
          <img
            src={ticket.image}
            alt={ticket.title}
            style={{
              width: 120,
              height: 80,
              objectFit: "cover",
              borderRadius: 8,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{ticket.title}</h3>
          <p style={{ margin: "4px 0", opacity: 0.7 }}>{ticket.venue}</p>
          <p style={{ margin: "4px 0", opacity: 0.6, fontSize: 14 }}>{ticket.date}</p>
          <p style={{ margin: "8px 0 0", fontWeight: 700, color: "rgba(6, 74, 147, 1)" }}>
            ${ticket.price.toFixed(2)}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              background:
                ticket.status === "SOLD"
                  ? "rgba(34, 197, 94, 0.15)"
                  : "rgba(245, 158, 11, 0.15)",
              color: ticket.status === "SOLD" ? "rgba(21, 128, 61, 1)" : "rgba(180, 83, 9, 1)",
              textAlign: "center",
            }}
          >
            {ticket.status}
          </span>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
            Purchased {new Date(ticket.orderDate).toLocaleDateString()}
          </p>
        </div>
      </div>

      {ticket.status === "SOLD" && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => setShowQR(!showQR)}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid rgba(6, 74, 147, 0.35)",
                background: "rgba(6, 74, 147, 1)",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {showQR ? "Hide QR Code" : "Show QR Code"}
            </button>
            <button
              onClick={handleDownloadQR}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.18)",
                background: "rgba(248, 250, 252, 1)",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Download QR
            </button>
          </div>

          {showQR && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <img
                src={`/api/tickets/${ticket.id}/qr`}
                alt="Ticket QR Code"
                style={{
                  maxWidth: 300,
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.1)",
                }}
              />
              <p style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>
                Show this QR code at the venue entrance
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Body() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTickets() {
      try {
        const res = await fetch("/api/account/tickets/bought", { cache: "no-store" });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || "Failed to load tickets");
        }

        setTickets(data.tickets || []);
      } catch (err: any) {
        setError(err.message || "Failed to load tickets");
      } finally {
        setLoading(false);
      }
    }

    fetchTickets();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ opacity: 0.7 }}>Loading your tickets...</div>
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

  if (tickets.length === 0) {
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
        <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>No tickets yet</h3>
        <p style={{ margin: 0, opacity: 0.7 }}>
          Tickets you purchase will appear here. Browse available tickets on the{" "}
          <Link href="/" style={{ textDecoration: "underline", color: "rgba(6, 74, 147, 1)" }}>
            homepage
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        You have {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
      </p>
      {tickets.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
    </div>
  );
}

export default function BoughtTicketsPage() {
  return (
    <Shell title="My Tickets">
      <AccountGate
        nextPath="/account/tickets/bought"
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
