"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";
import DisputeUpdateForm from "@/app/account/_components/dispute-update-form";
import { apiFetch } from "@/lib/api-fetch";

type SellerHoldingOrder = {
  id: string;
  status: string;
  amount: number;
  total: number;
  createdAt: string;
  transferDeadline: string;
  transferProofType: string | null;
  transferProofData: string | null;
  transferVerificationStatus: string | null;
  transferProofReviewRequest: { message: string; requestedAt: string | null } | null;
  buyerConfirmationStatus: string | null;
  buyerConfirmationAt: string | null;
  buyerConfirmationDeadline: string | null;
  adminRequests: Array<{ id: string; requestedAt: string; message: string }>;
  buyer: { name: string; email: string } | null;
  tickets: {
    id: string;
    title: string;
    venue: string;
    date: string;
    price: number;
    image: string;
    section: string | null;
    row: string | null;
    seat: string | null;
    status: string;
  }[];
};

const proofTypes = ["Email Confirmation", "Screenshot", "Other"];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 960, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Seller Holding</h1>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            <Link href="/account" style={{ textDecoration: "underline" }}>
              Back to Account
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

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(order: SellerHoldingOrder) {
  if (order.buyerConfirmationStatus === "DISPUTED") return "Dispute opened — payout paused";
  if (order.transferVerificationStatus === "MANUAL_REVIEW") return "Human review requested";
  if (!order.transferProofType) return "Transfer required";
  if (order.buyerConfirmationStatus === "CONFIRMED") return "Buyer confirmed";
  if (order.buyerConfirmationStatus === "AUTO_CONFIRMED") return "Auto-confirmed after 24 hours";
  return "Awaiting buyer confirmation";
}

function proofHelpText(proofType: string) {
  if (proofType === "Email Confirmation") return "Paste the key confirmation text from the transfer email.";
  if (proofType === "Screenshot") return "Add any caption or context for the screenshot.";
  return "Describe the transfer proof clearly enough for the admin team to understand it.";
}

function OrderCard({
  order,
  onSubmitted,
}: {
  order: SellerHoldingOrder;
  onSubmitted: () => void;
}) {
  const [proofType, setProofType] = useState(proofTypes[0]);
  const [proofData, setProofData] = useState("");
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [canRequestHumanReview, setCanRequestHumanReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const transferSubmitted = !!order.transferProofType;

  function handleProofFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setOk(null);
    setCanRequestHumanReview(false);
    setProofImage(null);
    setProofFileName(null);

    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setError("Upload a JPG, PNG, WebP, GIF, or PDF transfer confirmation.");
      event.target.value = "";
      return;
    }
    if (file.size > 3_000_000) {
      setError("Upload a transfer proof under 3 MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setProofImage(result);
      setProofFileName(file.name);
    };
    reader.onerror = () => {
      setError("Could not read that transfer proof upload.");
    };
    reader.readAsDataURL(file);
  }

  async function submitProof(event: React.FormEvent) {
    event.preventDefault();
    if (!proofImage) {
      setError("Upload a screenshot, image, or PDF confirmation before submitting proof.");
      return;
    }

    setBusy(true);
    setError(null);
    setOk(null);

    try {
      const res = await apiFetch("/api/orders/transfer-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          transferProofType: proofType,
          transferProofData: proofData,
          transferProofImage: proofImage,
          transferProofFileName: proofFileName,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setCanRequestHumanReview(data?.error === "TRANSFER_PROOF_MISMATCH");
        throw new Error(data?.message || data?.error || "Could not confirm transfer.");
      }
      setOk("Transfer proof checked and accepted. The buyer has been notified and has 24 hours to confirm receipt.");
      setProofData("");
      setProofImage(null);
      setProofFileName(null);
      onSubmitted();
    } catch (err: any) {
      setError(err.message || "Could not confirm transfer.");
    } finally {
      setBusy(false);
    }
  }

  async function requestHumanReview() {
    if (!proofImage) {
      setError("Upload the documentation you want TrueFanTix Support to review.");
      return;
    }

    setReviewBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await apiFetch("/api/orders/transfer-proof/human-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          transferProofType: proofType,
          transferProofData: proofData,
          transferProofImage: proofImage,
          transferProofFileName: proofFileName,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Could not request human review.");
      }
      setCanRequestHumanReview(false);
      setOk(data?.alreadyRequested
        ? "Human review has already been requested. This order is in the Admin Queue."
        : "Human review requested. Support has been emailed and this order is now in the Admin Queue.");
      onSubmitted();
    } catch (err: any) {
      setError(err.message || "Could not request human review.");
    } finally {
      setReviewBusy(false);
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Order {order.id}</h3>
          <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
            Buyer: {order.buyer?.name || "Buyer"} {order.buyer?.email ? `(${order.buyer.email})` : ""}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 900, color: "rgba(6, 74, 147, 1)" }}>${order.amount.toFixed(2)}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Payment protected until delivery</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <span style={badgeStyle("blue")}>{statusLabel(order)}</span>
        <span style={badgeStyle("green")}>
          Transfer by {formatDate(order.transferDeadline)}
        </span>
        {order.buyerConfirmationDeadline ? (
          <span style={badgeStyle("amber")}>
            Buyer confirm by {formatDate(order.buyerConfirmationDeadline)}
          </span>
        ) : null}
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {order.tickets.map((ticket) => (
          <div
            key={ticket.id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 10,
              borderRadius: 10,
              background: "rgba(249, 250, 251, 1)",
            }}
          >
            {ticket.image ? (
              <img src={ticket.image} alt={ticket.title} style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 8 }} />
            ) : null}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 900 }}>{ticket.title}</div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>{ticket.venue} - {ticket.date}</div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>
                {[
                  ticket.section ? `Section ${ticket.section}` : null,
                  ticket.row ? `Row ${ticket.row}` : null,
                  ticket.seat ? `Seat ${ticket.seat}` : null,
                ].filter(Boolean).join(", ") || "General admission"}
              </div>
            </div>
            <div style={{ fontWeight: 800 }}>${ticket.price.toFixed(2)}</div>
          </div>
        ))}
      </div>

      {!transferSubmitted ? (
        <form onSubmit={submitProof} style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {order.transferProofReviewRequest ? (
            <div role="status" style={{ padding: 12, borderRadius: 10, border: "2px solid rgba(249,115,22,.5)", background: "rgba(255,247,237,1)", color: "rgba(154,52,18,1)" }}>
              <div style={{ fontWeight: 950 }}>ACTION REQUIRED — Support needs updated transfer proof</div>
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{order.transferProofReviewRequest.message}</div>
              {order.transferProofReviewRequest.requestedAt ? <div style={{ marginTop: 5, fontSize: 12 }}>Requested {formatDate(order.transferProofReviewRequest.requestedAt)}</div> : null}
            </div>
          ) : null}
          <div style={instructionStyle}>
            <div style={{ fontWeight: 950, color: "rgba(15, 23, 42, 1)" }}>
              Transfer the tickets outside TrueFanTix first
            </div>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.45 }}>
              <li>Open the original ticket platform, such as Ticketmaster or AXS.</li>
              <li>
                Transfer all tickets in this order to{" "}
                <span style={{ fontWeight: 900 }}>{order.buyer?.email || "the buyer email shown above"}</span>.
              </li>
              <li>After the platform confirms the transfer, upload proof below.</li>
            </ol>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 800 }}>
              Proof type
              <select value={proofType} onChange={(e) => setProofType(e.target.value)} style={inputStyle}>
                {proofTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 800 }}>
              Proof note
              <input
                value={proofData}
                onChange={(e) => setProofData(e.target.value)}
                placeholder={proofHelpText(proofType)}
                style={inputStyle}
              />
              <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 700 }}>
                {proofHelpText(proofType)}
              </span>
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 800 }}>
            Upload transfer proof
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={handleProofFile}
              required
              style={inputStyle}
            />
            <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 700 }}>
              Required: the completed transfer, recipient email, event name and date or venue, plus ticket quantity and identifying details (section, row, seats, or general admission). Proof missing any of these details will not be accepted.
            </span>
            {proofFileName ? (
              <span style={{ fontSize: 12, color: "rgba(22, 101, 52, 1)", fontWeight: 900 }}>
                Ready to check: {proofFileName}
              </span>
            ) : null}
          </label>
          {error ? (
            <div role="alert" style={errorStyle}>
              <div>{error}</div>
              {canRequestHumanReview ? (
                <div style={{ marginTop: 8 }}>
                  Upload clearer or additional supporting documentation and try again. If you believe the current documentation is correct and complete, request a human review below.
                </div>
              ) : null}
            </div>
          ) : null}
          {ok ? <div role="status" style={okStyle}>{ok}</div> : null}
          <button
            type="submit"
            disabled={busy || !proofImage}
            aria-disabled={busy || !proofImage}
            style={{
              ...buttonStyle,
              ...((busy || !proofImage) ? disabledButtonStyle : {}),
            }}
          >
            {busy ? "Checking proof..." : "I transferred the tickets - check and submit proof"}
          </button>
          {canRequestHumanReview ? (
            <button
              type="button"
              onClick={requestHumanReview}
              disabled={reviewBusy || busy}
              style={{
                ...buttonStyle,
                background: "rgba(180, 83, 9, 1)",
                ...((reviewBusy || busy) ? disabledButtonStyle : {}),
              }}
            >
              {reviewBusy ? "Requesting human review..." : "Request Human Review"}
            </button>
          ) : null}
        </form>
      ) : (
        <div style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 10,
          background: order.transferVerificationStatus === "MANUAL_REVIEW" ? "rgba(255, 247, 237, 1)" : "rgba(240, 253, 244, 1)",
          color: order.transferVerificationStatus === "MANUAL_REVIEW" ? "rgba(154, 52, 18, 1)" : "rgba(22, 101, 52, 1)",
        }}>
          {order.transferVerificationStatus === "MANUAL_REVIEW"
            ? "Human review requested. Your documentation is in the Admin Queue and Support has been notified."
            : "Transfer confirmed by seller. Buyer confirmation is now pending."}
        </div>
      )}
      {order.buyerConfirmationStatus === "DISPUTED" ? (
        <DisputeUpdateForm orderId={order.id} adminRequests={order.adminRequests} onSubmitted={onSubmitted} />
      ) : null}
    </div>
  );
}

function badgeStyle(color: "blue" | "green" | "amber"): React.CSSProperties {
  const colors = {
    blue: ["rgba(219, 234, 254, 1)", "rgba(30, 64, 175, 1)"],
    green: ["rgba(220, 252, 231, 1)", "rgba(22, 101, 52, 1)"],
    amber: ["rgba(254, 243, 199, 1)", "rgba(146, 64, 14, 1)"],
  }[color];
  return {
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    background: colors[0],
    color: colors[1],
  };
}

const inputStyle: React.CSSProperties = {
  minHeight: 40,
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.18)",
  padding: "8px 10px",
};

const instructionStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid rgba(37, 99, 235, 0.18)",
  background: "rgba(239, 246, 255, 1)",
  color: "rgba(15, 23, 42, 0.88)",
};

const buttonStyle: React.CSSProperties = {
  minHeight: 42,
  border: 0,
  borderRadius: 8,
  background: "rgba(6, 74, 147, 1)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  background: "rgba(156, 163, 175, 1)",
  color: "rgba(255, 255, 255, 0.92)",
  cursor: "not-allowed",
  opacity: 0.8,
};

const errorStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  background: "rgba(254, 242, 242, 1)",
  color: "rgba(153, 27, 27, 1)",
};

const okStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  background: "rgba(240, 253, 244, 1)",
  color: "rgba(22, 101, 52, 1)",
};

function Body() {
  const [orders, setOrders] = useState<SellerHoldingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadOrders() {
    try {
      const res = await fetch("/api/account/tickets/seller-holding", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Failed to load seller holding orders.");
      }
      setOrders(data.orders || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load seller holding orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  if (loading) return <div style={{ opacity: 0.7, padding: 40, textAlign: "center" }}>Loading seller holding...</div>;
  if (error) return <div role="alert" style={errorStyle}>{error}</div>;
  if (!orders.length) {
    return (
      <div style={{ padding: 40, borderRadius: 12, border: "1px solid rgba(0,0,0,0.10)", background: "white", textAlign: "center" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>No seller holding orders</h3>
        <p style={{ margin: 0, opacity: 0.7 }}>Sold tickets awaiting transfer or buyer confirmation will appear here.</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        {orders.length} order{orders.length !== 1 ? "s" : ""} awaiting seller transfer or buyer confirmation.
      </p>
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} onSubmitted={loadOrders} />
      ))}
    </div>
  );
}

export default function SellerHoldingPage() {
  return (
    <Shell>
      <AccountGate
        nextPath="/account/tickets/seller-holding"
        loadingFallback={<p style={{ opacity: 0.8 }}>Loading...</p>}
        errorFallback={(message) => <div role="alert" style={errorStyle}>{message}</div>}
      >
        {() => <Body />}
      </AccountGate>
    </Shell>
  );
}
