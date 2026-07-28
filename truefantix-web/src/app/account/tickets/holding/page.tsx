"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";
import DisputeUpdateForm from "@/app/account/_components/dispute-update-form";
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

type DisputeScope = "ALL" | "SPECIFIC" | null;

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

function TicketCard({
  ticket,
  disputeFormTicketId,
  selectedTicketIds,
  disputeSelectionActive,
  disputeScope,
  disputeUpdateVisible,
  onChooseDisputeScope,
  onOpenDispute,
  onToggleDisputeTicket,
  onConfirmed,
}: {
  ticket: HoldingTicket;
  disputeFormTicketId: string | null;
  selectedTicketIds: string[];
  disputeSelectionActive: boolean;
  disputeScope: DisputeScope;
  disputeUpdateVisible: boolean;
  onChooseDisputeScope: (scope: Exclude<DisputeScope, null>) => void;
  onOpenDispute: (ticket: HoldingTicket) => void;
  onToggleDisputeTicket: (ticketId: string) => void;
  onConfirmed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeEvidenceFiles, setDisputeEvidenceFiles] = useState<Array<{
    data: string;
    fileName: string;
    size: number;
  }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disputeOpen = disputeFormTicketId === ticket.id;
  const selectedForDispute = selectedTicketIds.includes(ticket.id);
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
          ticketIds: selectedTicketIds,
          reason: disputeReason,
          evidenceFiles: disputeEvidenceFiles.map(({ data, fileName }) => ({ data, fileName })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not open dispute.");
      }
      setSuccess("Dispute opened. Seller payout is paused while admin reviews it.");
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
        border: selectedForDispute
          ? "2px solid rgba(37, 99, 235, 0.85)"
          : "1px solid rgba(0,0,0,0.10)",
        background: selectedForDispute ? "rgba(239, 246, 255, 1)" : "white",
        boxShadow: selectedForDispute ? "0 0 0 3px rgba(59, 130, 246, 0.12)" : "none",
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
              {disputeSelectionActive ? (
                <button
                  type="button"
                  onClick={() => {
                    if (disputeScope === "SPECIFIC") onToggleDisputeTicket(ticket.id);
                  }}
                  disabled={busy || disputeScope !== "SPECIFIC"}
                  aria-pressed={selectedForDispute}
                  style={{
                    minHeight: 38,
                    border: selectedForDispute ? 0 : "1px solid rgba(37, 99, 235, 0.45)",
                    borderRadius: 8,
                    background: selectedForDispute ? "rgba(37, 99, 235, 1)" : "white",
                    color: selectedForDispute ? "white" : "rgba(30, 64, 175, 1)",
                    fontWeight: 900,
                    cursor: disputeScope === "SPECIFIC" ? "pointer" : "default",
                    opacity: disputeScope ? 1 : 0.72,
                  }}
                >
                  {disputeScope === "ALL"
                    ? "✓ Included — all tickets"
                    : disputeScope === "SPECIFIC"
                      ? selectedForDispute
                        ? "✓ Selected"
                        : "Select ticket"
                      : "Choose all or specific tickets below"}
                </button>
              ) : (
                <>
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
                      onOpenDispute(ticket);
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
                </>
              )}
            </div>
          ) : null}
          {disputeOpen ? (
            <div style={{ display: "grid", gap: 8, minWidth: 260 }}>
              <div
                role="group"
                aria-labelledby={`dispute-scope-${ticket.id}`}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid rgba(37, 99, 235, 0.28)",
                  background: "white",
                }}
              >
                <div id={`dispute-scope-${ticket.id}`} style={{ fontSize: 13, fontWeight: 900 }}>
                  Is this dispute about all tickets in this order?
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onChooseDisputeScope("ALL")}
                    aria-pressed={disputeScope === "ALL"}
                    style={{
                      minHeight: 38,
                      border: disputeScope === "ALL" ? 0 : "1px solid rgba(37, 99, 235, 0.35)",
                      borderRadius: 8,
                      background: disputeScope === "ALL" ? "rgba(37, 99, 235, 1)" : "white",
                      color: disputeScope === "ALL" ? "white" : "rgba(30, 64, 175, 1)",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Yes — all tickets
                  </button>
                  <button
                    type="button"
                    onClick={() => onChooseDisputeScope("SPECIFIC")}
                    aria-pressed={disputeScope === "SPECIFIC"}
                    style={{
                      minHeight: 38,
                      border: disputeScope === "SPECIFIC" ? 0 : "1px solid rgba(37, 99, 235, 0.35)",
                      borderRadius: 8,
                      background: disputeScope === "SPECIFIC" ? "rgba(37, 99, 235, 1)" : "white",
                      color: disputeScope === "SPECIFIC" ? "white" : "rgba(30, 64, 175, 1)",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    No — specific tickets
                  </button>
                </div>
                <div style={{ fontSize: 12, opacity: 0.72 }}>
                  {disputeScope === "ALL"
                    ? "All tickets in this order are selected."
                    : disputeScope === "SPECIFIC"
                      ? "Use the Select ticket buttons on the affected ticket cards."
                      : "Choose one option before continuing."}
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(153, 27, 27, 1)" }}>
                  Opening a dispute pauses seller payout for the entire order while the issue is reviewed.
                </div>
              </div>
              <textarea
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value)}
                placeholder="Describe what went wrong with the ticket transfer"
                rows={4}
                style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", resize: "vertical" }}
              />
              <label
                htmlFor={`dispute-file-${ticket.id}`}
                style={{
                  display: "inline-flex",
                  justifyContent: "center",
                  alignItems: "center",
                  minHeight: 40,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(37, 99, 235, 0.45)",
                  background: "white",
                  color: "rgba(30, 64, 175, 1)",
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Upload supporting documents (optional)
                <input
                  id={`dispute-file-${ticket.id}`}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}
                  onChange={async (event) => {
                    const files = Array.from(event.target.files || []);
                    setError(null);
                    event.target.value = "";
                    if (files.length === 0) {
                      return;
                    }
                    if (disputeEvidenceFiles.length + files.length > 5) {
                      setError("You can attach up to 5 supporting documents.");
                      return;
                    }
                    const totalSize =
                      disputeEvidenceFiles.reduce((sum, file) => sum + file.size, 0) +
                      files.reduce((sum, file) => sum + file.size, 0);
                    if (totalSize > 2_000_000) {
                      setError("Supporting documents must be 2 MB or smaller in total.");
                      return;
                    }
                    try {
                      const uploaded = await Promise.all(
                        files.map(
                          (file) =>
                            new Promise<{ data: string; fileName: string; size: number }>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => {
                                if (typeof reader.result !== "string") {
                                  reject(new Error("Could not read file."));
                                  return;
                                }
                                resolve({ data: reader.result, fileName: file.name, size: file.size });
                              };
                              reader.onerror = () => reject(new Error("Could not read file."));
                              reader.readAsDataURL(file);
                            })
                        )
                      );
                      setDisputeEvidenceFiles((current) => [...current, ...uploaded]);
                    } catch {
                      setError("Could not read one or more selected supporting documents.");
                    }
                  }}
                />
              </label>
              {disputeEvidenceFiles.length > 0 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {disputeEvidenceFiles.map((file, index) => (
                    <div
                      key={`${file.fileName}-${index}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "7px 9px",
                        borderRadius: 7,
                        background: "rgba(239, 246, 255, 1)",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ overflowWrap: "anywhere" }}>Attached: {file.fileName}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDisputeEvidenceFiles((current) =>
                            current.filter((_, fileIndex) => fileIndex !== index)
                          )
                        }
                        aria-label={`Remove ${file.fileName}`}
                        style={{
                          border: 0,
                          background: "transparent",
                          color: "rgba(185, 28, 28, 1)",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ fontSize: 12, opacity: 0.68, textAlign: "center" }}>
                Select up to 5 JPG, PNG, WebP, PDF, DOC, or DOCX files — maximum 2 MB total.
              </div>
              <button
                type="button"
                onClick={openDispute}
                disabled={
                  busy ||
                  disputeScope === null ||
                  selectedTicketIds.length === 0 ||
                  disputeReason.trim().length < 10
                }
                style={{
                  minHeight: 38,
                  border: 0,
                  borderRadius: 8,
                  background:
                    disputeScope !== null && selectedTicketIds.length > 0 && disputeReason.trim().length >= 10
                      ? "rgba(185, 28, 28, 1)"
                      : "rgba(148, 163, 184, 1)",
                  color: "white",
                  fontWeight: 900,
                  cursor:
                    disputeScope !== null && selectedTicketIds.length > 0 && disputeReason.trim().length >= 10
                      ? "pointer"
                      : "not-allowed",
                }}
              >
                {busy ? "Opening..." : "Submit dispute"}
              </button>
            </div>
          ) : null}
          {disputeUpdateVisible ? <DisputeUpdateForm orderId={ticket.orderId} /> : null}
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
  const [disputeFormTicketId, setDisputeFormTicketId] = useState<string | null>(null);
  const [disputeOrderId, setDisputeOrderId] = useState<string | null>(null);
  const [disputeScope, setDisputeScope] = useState<DisputeScope>(null);
  const [selectedDisputeTicketIds, setSelectedDisputeTicketIds] = useState<string[]>([]);

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
    setDisputeFormTicketId(null);
    setDisputeOrderId(null);
    setDisputeScope(null);
    setSelectedDisputeTicketIds([]);
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
          disputeFormTicketId={disputeFormTicketId}
          selectedTicketIds={selectedDisputeTicketIds}
          disputeSelectionActive={disputeOrderId === ticket.orderId}
          disputeScope={disputeOrderId === ticket.orderId ? disputeScope : null}
          disputeUpdateVisible={
            ticket.buyerConfirmationStatus === "DISPUTED" &&
            tickets.find((candidate) => candidate.orderId === ticket.orderId)?.id === ticket.id
          }
          onOpenDispute={(openedTicket) => {
            setDisputeFormTicketId(openedTicket.id);
            setDisputeOrderId(openedTicket.orderId);
            setDisputeScope(null);
            setSelectedDisputeTicketIds([]);
          }}
          onChooseDisputeScope={(scope) => {
            setDisputeScope(scope);
            setSelectedDisputeTicketIds(
              scope === "ALL"
                ? tickets
                    .filter((candidate) => candidate.orderId === disputeOrderId)
                    .map((candidate) => candidate.id)
                : []
            );
          }}
          onToggleDisputeTicket={(ticketId) =>
            setSelectedDisputeTicketIds((current) =>
              current.includes(ticketId)
                ? current.filter((selectedId) => selectedId !== ticketId)
                : [...current, ticketId]
            )
          }
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
