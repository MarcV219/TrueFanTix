"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";
import { apiFetch } from "@/lib/api-fetch";

type HoldingTicket = {
  id: string;
  title: string;
  venue: string;
  date: string;
  section: string | null;
  row: string | null;
  seat: string | null;
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
  if (ticket.orderStatus === "PAID" && ticket.buyerConfirmationStatus === "DISPUTED") return "Dispute opened";
  if (ticket.orderStatus === "PAID" && ticket.transferVerificationStatus === "PENDING") return "Confirm receipt";
  if (ticket.orderStatus === "PAID") return "Awaiting seller transfer";
  if (ticket.orderStatus === "DELIVERED" && ticket.buyerConfirmationStatus === "CONFIRMED") return "Transfer confirmed";
  if (ticket.orderStatus === "DELIVERED") return "Transferred - awaiting final completion";
  return ticket.orderStatus;
}

function fulfillmentTooltip(ticket: HoldingTicket) {
  if (ticket.orderStatus === "PAID" && ticket.buyerConfirmationStatus === "DISPUTED") {
    return "A dispute is open, so seller payout stays paused while the issue is reviewed.";
  }
  if (ticket.orderStatus === "PAID" && ticket.transferVerificationStatus === "PENDING") {
    return "The seller submitted transfer proof. Confirm receipt only after the tickets are visible in your ticket provider account, or open a dispute if something is wrong.";
  }
  if (ticket.orderStatus === "PAID") {
    return "Your payment was accepted and the seller has 24 hours to transfer the tickets through the original ticket provider. You will be prompted to confirm receipt after transfer proof is submitted.";
  }
  if (ticket.orderStatus === "DELIVERED" && ticket.buyerConfirmationStatus === "CONFIRMED") {
    return "You confirmed receipt of the transferred tickets. This order is waiting for final completion.";
  }
  if (ticket.orderStatus === "DELIVERED") {
    return "The seller has submitted transfer proof. Confirm receipt after the tickets are in your account, or open a dispute before the confirmation window ends.";
  }
  return "This is the current order status.";
}

function StatusPillWithTooltip({
  children,
  tooltip,
  tone,
}: {
  children: React.ReactNode;
  tooltip: string;
  tone: "blue" | "green";
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = React.useId();
  const colors =
    tone === "green"
      ? {
          background: "rgba(240, 253, 244, 1)",
          color: "rgba(22, 101, 52, 1)",
          border: "1px solid rgba(34, 197, 94, 0.28)",
        }
      : {
          background: "rgba(219, 234, 254, 1)",
          color: "rgba(30, 64, 175, 1)",
          border: "1px solid rgba(59, 130, 246, 0.28)",
        };

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        justifyContent: "center",
        width: "100%",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        style={{
          width: "100%",
          padding: "6px 12px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 900,
          background: colors.background,
          color: colors.color,
          border: colors.border,
          textAlign: "center",
          cursor: "help",
          outlineOffset: 2,
        }}
      >
        {children}
      </span>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 20,
            right: 0,
            bottom: "calc(100% + 8px)",
            width: "min(320px, 78vw)",
            padding: 10,
            borderRadius: 8,
            border: "1px solid rgba(15, 23, 42, 0.14)",
            background: "rgba(15, 23, 42, 0.96)",
            color: "white",
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.20)",
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.35,
            textAlign: "left",
          }}
        >
          {tooltip}
        </span>
      ) : null}
    </span>
  );
}

function ticketSelectionLabel(ticket: HoldingTicket) {
  const seatDetails = [
    ticket.section ? `Section ${ticket.section}` : null,
    ticket.row ? `Row ${ticket.row}` : null,
    ticket.seat ? `Seat ${ticket.seat}` : null,
  ].filter(Boolean);
  return seatDetails.length ? `${ticket.title} — ${seatDetails.join(", ")}` : `${ticket.title} — $${ticket.price.toFixed(2)}`;
}

function TicketCard({
  ticket,
  orderTickets,
  onConfirmed,
}: {
  ticket: HoldingTicket;
  orderTickets: HoldingTicket[];
  onConfirmed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeEvidence, setDisputeEvidence] = useState("");
  const [disputedTicketIds, setDisputedTicketIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canConfirm =
    ticket.orderStatus === "PAID" &&
    ticket.transferVerificationStatus === "PENDING" &&
    ticket.buyerConfirmationStatus === "PENDING";

  async function confirmReceipt() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch("/api/orders/confirm-receipt", {
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

  async function openDispute() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch("/api/orders/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: ticket.orderId,
          ticketIds: disputedTicketIds,
          reason: disputeReason,
          evidence: disputeEvidence || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not open dispute.");
      }
      setSuccess("Dispute opened. Seller payout is paused while admin reviews it.");
      setDisputeOpen(false);
      onConfirmed();
    } catch (err: any) {
      setError(err.message || "Could not open dispute.");
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
          <StatusPillWithTooltip tooltip={fulfillmentTooltip(ticket)} tone="blue">
            {fulfillmentLabel(ticket)}
          </StatusPillWithTooltip>
          <StatusPillWithTooltip
            tooltip="Your payment is held by TrueFanTix while the seller transfers the tickets. Seller payout is not released until you confirm receipt, the 24-hour confirmation window ends without a dispute, or an admin resolves the case."
            tone="green"
          >
            Payment protected until delivery
          </StatusPillWithTooltip>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.62, textAlign: "center" }}>
            Purchased {new Date(ticket.orderDate).toLocaleDateString()}
          </p>
          {ticket.buyerConfirmationDeadline ? (
            <p style={{ margin: 0, fontSize: 12, opacity: 0.72, textAlign: "center" }}>
              Confirm by {new Date(ticket.buyerConfirmationDeadline).toLocaleString()}
            </p>
          ) : null}
          {canConfirm ? (
            <div style={{ display: "grid", gap: 8 }}>
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
                {busy ? "Working..." : "Confirm received"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisputeOpen((current) => !current);
                  setError(null);
                  setSuccess(null);
                }}
                disabled={busy}
                style={{
                  minHeight: 38,
                  border: "1px solid rgba(185, 28, 28, 0.35)",
                  borderRadius: 8,
                  background: "white",
                  color: "rgba(185, 28, 28, 1)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Open dispute
              </button>
            </div>
          ) : null}
          {disputeOpen ? (
            <div style={{ display: "grid", gap: 8, minWidth: 260 }}>
              <fieldset
                style={{
                  display: "grid",
                  gap: 8,
                  margin: 0,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.16)",
                }}
              >
                <legend style={{ padding: "0 4px", fontWeight: 900, fontSize: 13 }}>
                  Which tickets are you disputing?
                </legend>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.72 }}>
                  Select every ticket affected by this issue.
                </p>
                {orderTickets.map((orderTicket) => {
                  const checkboxId = `dispute-${ticket.id}-${orderTicket.id}`;
                  return (
                    <label
                      key={orderTicket.id}
                      htmlFor={checkboxId}
                      style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer" }}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={disputedTicketIds.includes(orderTicket.id)}
                        onChange={(event) =>
                          setDisputedTicketIds((current) =>
                            event.target.checked
                              ? [...current, orderTicket.id]
                              : current.filter((ticketId) => ticketId !== orderTicket.id)
                          )
                        }
                      />
                      <span>{ticketSelectionLabel(orderTicket)}</span>
                    </label>
                  );
                })}
              </fieldset>
              <textarea
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value)}
                placeholder="Describe what went wrong with the ticket transfer"
                rows={4}
                style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", resize: "vertical" }}
              />
              <input
                value={disputeEvidence}
                onChange={(event) => setDisputeEvidence(event.target.value)}
                placeholder="Optional evidence link or transfer details"
                style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)" }}
              />
              <button
                type="button"
                onClick={openDispute}
                disabled={busy || disputedTicketIds.length === 0 || disputeReason.trim().length < 10}
                style={{
                  minHeight: 38,
                  border: 0,
                  borderRadius: 8,
                  background:
                    disputedTicketIds.length > 0 && disputeReason.trim().length >= 10
                      ? "rgba(185, 28, 28, 1)"
                      : "rgba(148, 163, 184, 1)",
                  color: "white",
                  fontWeight: 900,
                  cursor:
                    disputedTicketIds.length > 0 && disputeReason.trim().length >= 10 ? "pointer" : "not-allowed",
                }}
              >
                {busy ? "Opening..." : "Submit dispute"}
              </button>
            </div>
          ) : null}
          {success ? (
            <div
              role="status"
              style={{
                padding: 8,
                borderRadius: 8,
                background: "rgba(240, 253, 244, 1)",
                color: "rgba(22, 101, 52, 1)",
                fontSize: 12,
              }}
            >
              {success}
            </div>
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
        <TicketCard
          key={`${ticket.orderId}-${ticket.id}`}
          ticket={ticket}
          orderTickets={tickets.filter((candidate) => candidate.orderId === ticket.orderId)}
          onConfirmed={refetchTickets}
        />
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
