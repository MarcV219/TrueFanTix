"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

function money(cents: number | null | undefined, currency = "CAD") {
  if (cents == null) return "-";
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)" }}>
      <div style={{ fontSize: 12, opacity: 0.65 }}>{label}</div>
      <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{value || "-"}</div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: "rgba(15,23,42,1)", color: "white", overflow: "auto", maxHeight: 360, fontSize: 12 }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function parseTransferProofData(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as {
      sellerNote?: string;
      fileName?: string | null;
      proofUpload?: string | null;
      review?: unknown;
      reviewedAt?: string;
      manualReviewRequestedAt?: string;
      adminReviews?: Array<{
        id?: string;
        action?: "APPROVE" | "REJECT" | "REQUEST_INFORMATION";
        note?: string;
        decidedAt?: string;
      }>;
    };
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

type DisputeRecord = {
  type?: string;
  ticketIds?: string[];
  ticketCount?: number;
  reason?: string;
  evidence?: string | null;
  evidenceFile?: string | null;
  evidenceFileName?: string | null;
  evidenceFiles?: Array<{ data?: string; fileName?: string }>;
  openedAt?: string;
  cancellation?: {
    cancelledAt?: string;
    cancelledByUserId?: string;
    satisfactorilyResolved?: boolean;
  };
  submissions?: Array<{
    id?: string;
    submittedAt?: string;
    submittedByRole?: string;
    comments?: string | null;
    evidenceFiles?: Array<{ data?: string; fileName?: string }>;
  }>;
  adminRequests?: Array<{
    id?: string;
    requestedAt?: string;
    recipient?: "BUYER" | "SELLER" | "BOTH";
    message?: string;
    deliveries?: Array<{ role?: string; email?: string; status?: string }>;
  }>;
};

function parseDisputeRecord(value: unknown): DisputeRecord | null {
  if (typeof value !== "string") return null;
  try {
    let parsed = JSON.parse(value) as (DisputeRecord & { dispute?: unknown }) | null;
    for (let depth = 0; parsed && depth < 10; depth += 1) {
      if (parsed.type === "BUYER_DISPUTE") return parsed;
      parsed =
        typeof parsed.dispute === "object" && parsed.dispute !== null
          ? parsed.dispute as DisputeRecord & { dispute?: unknown }
          : null;
    }
    return null;
  } catch {
    return null;
  }
}

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [order, setOrder] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [decisionNote, setDecisionNote] = React.useState("");
  const [decisionBusy, setDecisionBusy] = React.useState(false);
  const [decisionMessage, setDecisionMessage] = React.useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = React.useState<"RELEASE_PAYOUT" | "MARK_REFUND_REQUIRED" | null>(null);
  const [requestRecipient, setRequestRecipient] = React.useState<"BUYER" | "SELLER" | "BOTH">("BUYER");
  const [requestMessage, setRequestMessage] = React.useState("");
  const [requestBusy, setRequestBusy] = React.useState(false);
  const [requestResult, setRequestResult] = React.useState<string | null>(null);
  const [proofReviewNote, setProofReviewNote] = React.useState("");
  const [proofReviewBusy, setProofReviewBusy] = React.useState(false);
  const [proofReviewResult, setProofReviewResult] = React.useState<string | null>(null);
  const [pendingProofAction, setPendingProofAction] = React.useState<"APPROVE" | "REJECT" | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load order.");
      setOrder(json.order);
    } catch (err: any) {
      setError(err?.message || "Failed to load order.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  const disputeRecord = parseDisputeRecord(order?.transferVerificationReason);
  const disputeEvidenceFiles = disputeRecord
    ? disputeRecord.evidenceFiles?.filter((file) => file?.data) ||
      (disputeRecord.evidenceFile
        ? [{ data: disputeRecord.evidenceFile, fileName: disputeRecord.evidenceFileName || undefined }]
        : [])
    : [];
  const disputeTimeline = disputeRecord
    ? [
        ...(disputeRecord.openedAt
          ? [{
              kind: "OPENED" as const,
              id: "dispute-opened",
              at: disputeRecord.openedAt,
              label: "BUYER opened dispute",
              message: disputeRecord.reason || "-",
              files: disputeEvidenceFiles,
            }]
          : []),
        ...(disputeRecord.submissions || []).map((submission, index) => ({
          kind: "SUBMISSION" as const,
          id: submission.id || `submission-${index}`,
          at: submission.submittedAt || "",
          label: `${submission.submittedByRole || "PARTY"} update`,
          message: submission.comments || "(documents only)",
          files: submission.evidenceFiles || [],
        })),
        ...(disputeRecord.adminRequests || []).map((request, index) => ({
          kind: "ADMIN_REQUEST" as const,
          id: request.id || `admin-request-${index}`,
          at: request.requestedAt || "",
          label: `ADMIN requested information from ${request.recipient === "BOTH" ? "BUYER AND SELLER" : request.recipient || "PARTY"}`,
          message: request.message || "-",
          files: [] as Array<{ data?: string; fileName?: string }>,
          deliveries: request.deliveries || [],
        })),
      ].sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))
    : [];

  async function resolveDispute(action: "RELEASE_PAYOUT" | "MARK_REFUND_REQUIRED" | "KEEP_UNDER_REVIEW") {
    setDecisionBusy(true);
    setError(null);
    setDecisionMessage("Updating dispute...");
    try {
      const res = await apiFetch(`/api/admin/orders/${encodeURIComponent(id)}/resolve-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: decisionNote }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Could not resolve dispute.");
      setDecisionMessage(json.message || "Dispute updated.");
      setDecisionNote("");
      setPendingDecision(null);
      await load();
    } catch (err: any) {
      setDecisionMessage(`Decision failed: ${err?.message || "Could not resolve dispute."}`);
    } finally {
      setDecisionBusy(false);
    }
  }

  function beginDecision(action: "RELEASE_PAYOUT" | "MARK_REFUND_REQUIRED" | "KEEP_UNDER_REVIEW") {
    if (decisionNote.trim().length < 3) {
      setDecisionMessage("Enter an Admin decision note of at least 3 characters.");
      return;
    }
    setDecisionMessage(null);
    if (action === "KEEP_UNDER_REVIEW") {
      resolveDispute(action);
      return;
    }
    setPendingDecision(action);
  }

  async function requestInformation() {
    setRequestBusy(true);
    setError(null);
    setRequestResult(null);
    try {
      setRequestResult("Sending request...");
      const res = await apiFetch(`/api/admin/orders/${encodeURIComponent(id)}/request-information`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: requestRecipient, message: requestMessage }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Could not send the information request.");
      setRequestResult(json.message || "Information request sent.");
      setRequestMessage("");
      await load();
    } catch (err: any) {
      setRequestResult(`Request failed: ${err?.message || "Could not send the information request."}`);
    } finally {
      setRequestBusy(false);
    }
  }

  async function reviewTransferProof(action: "APPROVE" | "REJECT" | "REQUEST_INFORMATION") {
    if (proofReviewNote.trim().length < 3) {
      setProofReviewResult("Enter an Admin note of at least 3 characters.");
      return;
    }
    setProofReviewBusy(true);
    setProofReviewResult("Updating transfer-proof review...");
    try {
      const res = await apiFetch(`/api/admin/orders/${encodeURIComponent(id)}/review-transfer-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: proofReviewNote }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Could not update the transfer-proof review.");
      setProofReviewResult(`${json.message || "Transfer-proof review updated."}${json.warning ? " The decision was saved, but the seller email failed to send." : ""}`);
      setProofReviewNote("");
      setPendingProofAction(null);
      await load();
    } catch (err: any) {
      setProofReviewResult(`Review failed: ${err?.message || "Could not update the transfer-proof review."}`);
    } finally {
      setProofReviewBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin - Order Review</h1>
          <Link href="/admin/orders" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Orders</Link>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading order...</div> : null}

      {order ? (
        <div style={{ display: "grid", gap: 16 }}>
          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Order {order.id}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
              <Field label="Status" value={order.status} />
              <Field label="Created" value={new Date(order.createdAt).toLocaleString()} />
              <Field label="Seller" value={order.seller?.name || order.sellerId} />
              <Field label="Buyer" value={`${order.buyerSeller?.name || order.buyerSellerId} ${order.buyerSeller?.user?.email ? `(${order.buyerSeller.user.email})` : ""}`} />
              <Field label="Subtotal" value={money(order.amountCents, order.currency)} />
              <Field label="Admin Fee" value={money(order.adminFeeCents, order.currency)} />
              <Field label="Tax" value={money(order.adminFeeTaxCents, order.currency)} />
              <Field label="Total" value={money(order.totalCents, order.currency)} />
              <Field label="Payment" value={order.payment ? `${order.payment.status} / ${order.payment.provider} / ${order.payment.providerRef}` : "No payment"} />
              <Field label="Transfer Proof" value={order.transferProofType || "-"} />
              <Field
                label="Transfer Verification"
                value={
                  disputeRecord
                    ? `${order.transferVerificationStatus || "-"} — buyer dispute affecting ${disputeRecord.ticketCount || disputeRecord.ticketIds?.length || 0} ticket(s)`
                    : `${order.transferVerificationStatus || "-"} ${order.transferVerificationReason || ""}`
                }
              />
              {disputeRecord?.cancellation ? (
                <Field
                  label="Buyer dispute cancellation"
                  value={`${disputeRecord.cancellation.satisfactorilyResolved ? "Satisfactorily resolved" : "Cancelled"}${disputeRecord.cancellation.cancelledAt ? ` — ${new Date(disputeRecord.cancellation.cancelledAt).toLocaleString()}` : ""}`}
                />
              ) : null}
              <Field label="Buyer Confirmation" value={`${order.buyerConfirmationStatus || "-"} ${order.buyerConfirmationAt ? new Date(order.buyerConfirmationAt).toLocaleString() : ""}`} />
            </div>
            {order.buyerConfirmationStatus === "DISPUTED" ? (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 10, border: "1px solid rgba(185,28,28,0.28)", background: "rgba(254,242,242,1)" }}>
                <h3 style={{ margin: "0 0 8px", color: "rgba(153,27,27,1)" }}>Dispute review</h3>
                <p style={{ margin: "0 0 10px", opacity: 0.8 }}>
                  Seller payout is paused while this order is disputed. Add an admin note before making a decision.
                </p>
                {disputeRecord ? (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    <Field label="Affected ticket IDs" value={disputeRecord.ticketIds?.join(", ") || "-"} />
                    <Field label="Buyer’s explanation" value={disputeRecord.reason || "-"} />
                    <h4 style={{ margin: "6px 0 0" }}>Communications — earliest to latest</h4>
                    {disputeTimeline.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          border: entry.kind === "ADMIN_REQUEST" ? "1px solid rgba(37,99,235,.22)" : "1px solid rgba(0,0,0,.12)",
                          background: entry.kind === "ADMIN_REQUEST" ? "rgba(239,246,255,1)" : "white",
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>
                          {entry.label}
                          {entry.at ? ` — ${new Date(entry.at).toLocaleString()}` : ""}
                        </div>
                        <div style={{ marginTop: 5, whiteSpace: "pre-wrap" }}>{entry.message}</div>
                        {entry.files.map((file, fileIndex) => file.data ? (
                          <a key={`${file.fileName}-${fileIndex}`} href={file.data} download={file.fileName || `dispute-document-${fileIndex + 1}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6, fontWeight: 900, textDecoration: "underline" }}>
                            Open document: {file.fileName || `Attachment ${fileIndex + 1}`}
                          </a>
                        ) : null)}
                        {entry.kind === "ADMIN_REQUEST" ? (
                          <div style={{ marginTop: 5, fontSize: 12, opacity: 0.72 }}>
                            {(entry.deliveries || []).map((delivery) => `${delivery.role}: ${delivery.status}`).join(" • ")}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid rgba(37,99,235,0.24)", background: "white" }}>
                  <h4 style={{ margin: "0 0 8px" }}>Request more information / supporting backup</h4>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    {(["BUYER", "SELLER", "BOTH"] as const).map((recipient) => (
                      <button
                        key={recipient}
                        type="button"
                        onClick={() => setRequestRecipient(recipient)}
                        style={{
                          padding: "7px 10px",
                          borderRadius: 999,
                          border: requestRecipient === recipient ? "1px solid rgba(37,99,235,.55)" : "1px solid rgba(0,0,0,.14)",
                          background: requestRecipient === recipient ? "rgba(239,246,255,1)" : "white",
                          fontWeight: 800,
                        }}
                      >
                        {recipient === "BOTH" ? "Buyer and seller" : recipient === "BUYER" ? "Buyer" : "Seller"}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={requestMessage}
                    onChange={(event) => {
                      setRequestMessage(event.target.value);
                      setRequestResult(null);
                    }}
                    rows={4}
                    placeholder="Explain exactly what information or supporting documents are required"
                    style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", resize: "vertical" }}
                  />
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                    {requestMessage.trim().length === 0
                      ? "Enter a message to send."
                      : requestMessage.trim().length < 3
                        ? "Enter at least 3 characters."
                        : "Ready to send."}
                  </div>
                  <button
                    type="button"
                    onClick={requestInformation}
                    disabled={requestBusy || requestMessage.trim().length < 3}
                    style={{ marginTop: 8, padding: "9px 12px", borderRadius: 8, border: 0, background: "rgba(6,74,147,1)", color: "white", fontWeight: 900, opacity: requestBusy || requestMessage.trim().length < 3 ? 0.45 : 1, cursor: requestBusy || requestMessage.trim().length < 3 ? "not-allowed" : "pointer" }}
                  >
                    {requestBusy ? "Sending request..." : `Send request to ${requestRecipient === "BOTH" ? "buyer and seller" : requestRecipient.toLowerCase()}`}
                  </button>
                  {requestResult ? (
                    <div
                      role="status"
                      aria-live="polite"
                      style={{
                        marginTop: 8,
                        color: requestResult.startsWith("Request failed") ? "rgba(153,27,27,1)" : "rgba(22,101,52,1)",
                        fontWeight: 800,
                      }}
                    >
                      {requestResult}
                    </div>
                  ) : null}
                </div>
                <textarea
                  value={decisionNote}
                  onChange={(event) => {
                    setDecisionNote(event.target.value);
                    setDecisionMessage(null);
                    setPendingDecision(null);
                  }}
                  rows={4}
                  placeholder="Admin decision note"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", resize: "vertical" }}
                />
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.72 }}>
                  {decisionNote.trim().length < 3
                    ? "Enter an Admin decision note (at least 3 characters) before choosing an action."
                    : "Decision note ready."}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => beginDecision("KEEP_UNDER_REVIEW")}
                    disabled={decisionBusy}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white", fontWeight: 900 }}
                  >
                    Keep under review
                  </button>
                  <button
                    type="button"
                    onClick={() => beginDecision("MARK_REFUND_REQUIRED")}
                    disabled={decisionBusy}
                    style={{ padding: "10px 12px", borderRadius: 8, border: 0, background: "rgba(185,28,28,1)", color: "white", fontWeight: 900 }}
                  >
                    Refund buyer and close dispute
                  </button>
                  <button
                    type="button"
                    onClick={() => beginDecision("RELEASE_PAYOUT")}
                    disabled={decisionBusy}
                    style={{ padding: "10px 12px", borderRadius: 8, border: 0, background: "rgba(22,101,52,1)", color: "white", fontWeight: 900 }}
                  >
                    Release seller payout
                  </button>
                </div>
                {pendingDecision ? (
                  <div style={{ marginTop: 10, padding: 12, borderRadius: 8, border: "1px solid rgba(245,158,11,.4)", background: "rgba(255,251,235,1)" }}>
                    <strong>Confirm this decision</strong>
                    <div style={{ marginTop: 4, fontSize: 13 }}>
                      {pendingDecision === "RELEASE_PAYOUT"
                        ? "This closes the dispute, completes the order, and places the seller payout in the pending payout queue."
                        : "This immediately issues a full Stripe refund, closes the dispute for buyer, seller, and Support, cancels any pending seller payout, and withdraws the tickets from sale."}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={() => resolveDispute(pendingDecision)} disabled={decisionBusy} style={{ padding: "8px 11px", borderRadius: 8, border: 0, background: pendingDecision === "RELEASE_PAYOUT" ? "rgba(22,101,52,1)" : "rgba(185,28,28,1)", color: "white", fontWeight: 900 }}>
                        {decisionBusy ? "Applying..." : "Yes, apply decision"}
                      </button>
                      <button type="button" onClick={() => setPendingDecision(null)} disabled={decisionBusy} style={{ padding: "8px 11px", borderRadius: 8, border: "1px solid rgba(0,0,0,.14)", background: "white", fontWeight: 900 }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {decisionMessage ? (
                  <div role="status" aria-live="polite" style={{ marginTop: 10, color: decisionMessage.includes("failed") || decisionMessage.startsWith("Enter") ? "rgba(153,27,27,1)" : "rgba(22,101,52,1)", fontWeight: 800 }}>
                    {decisionMessage}
                  </div>
                ) : null}
              </div>
            ) : disputeRecord ? (
              <div style={{ marginTop: 12, padding: 14, borderRadius: 10, border: "1px solid rgba(22,101,52,.28)", background: "rgba(240,253,244,1)" }}>
                <h3 style={{ margin: "0 0 6px", color: "rgba(22,101,52,1)" }}>Dispute resolved</h3>
                <p style={{ margin: 0 }}>The complete dispute record remains preserved below and in the Disputes resolved section.</p>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                    Archived communications ({disputeTimeline.length})
                  </summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {disputeTimeline.map((entry) => (
                      <div key={entry.id} style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,.1)", background: "white" }}>
                        <div style={{ fontWeight: 900 }}>
                          {entry.label}{entry.at ? ` — ${new Date(entry.at).toLocaleString()}` : ""}
                        </div>
                        <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{entry.message}</div>
                        {entry.files.map((file, index) => file.data ? (
                          <a key={`${entry.id}-${index}`} href={file.data} download={file.fileName || `dispute-document-${index + 1}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 5, fontWeight: 900, textDecoration: "underline" }}>
                            Open document: {file.fileName || `Attachment ${index + 1}`}
                          </a>
                        ) : null)}
                      </div>
                    ))}
                  </div>
                </details>
                <Link href="/admin/orders?status=RESOLVED_DISPUTES" style={{ display: "inline-block", marginTop: 8, fontWeight: 900, textDecoration: "underline" }}>
                  View disputes resolved
                </Link>
              </div>
            ) : null}
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 900 }}>Complete transaction and case history</summary>
              <p style={{ fontSize: 13, opacity: .72 }}>
                Order creation, payment, emails, audit events, escrow activity, access-token transactions, payout records, and order messages.
              </p>
              <JsonBlock value={order.caseHistory} />
            </details>
            {order.transferProofData ? (() => {
              const transferProof = parseTransferProofData(order.transferProofData);
              const proofUpload = transferProof?.proofUpload ?? null;
              const isImageProof = typeof proofUpload === "string" && /^data:image\//i.test(proofUpload);
              const isPdfProof = typeof proofUpload === "string" && /^data:application\/pdf/i.test(proofUpload);

              if (!transferProof) {
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Transfer proof data</div>
                    <div style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", overflowWrap: "anywhere" }}>{order.transferProofData}</div>
                  </div>
                );
              }

              return (
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {order.transferVerificationStatus === "MANUAL_REVIEW" && !disputeRecord ? (
                    <div style={{ padding: 14, borderRadius: 10, border: "1px solid rgba(234,88,12,.35)", background: "rgba(255,247,237,1)" }}>
                      <h3 style={{ margin: "0 0 6px", color: "rgba(154,52,18,1)" }}>Transfer-proof human review</h3>
                      <p style={{ margin: "0 0 10px", opacity: .82 }}>
                        Review the uploaded proof, record a note, then choose one standard outcome. Approve and reject remove it from this queue; requesting information keeps it here.
                      </p>
                      <textarea
                        value={proofReviewNote}
                        onChange={(event) => {
                          setProofReviewNote(event.target.value);
                          setProofReviewResult(null);
                          setPendingProofAction(null);
                        }}
                        rows={4}
                        placeholder="Explain the decision or specify exactly what supporting information is needed"
                        style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,.16)", resize: "vertical" }}
                      />
                      <div style={{ marginTop: 4, fontSize: 12, opacity: .72 }}>
                        {proofReviewNote.trim().length < 3 ? "Enter an Admin note of at least 3 characters." : "Admin note ready."}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        <button type="button" onClick={() => setPendingProofAction("APPROVE")} disabled={proofReviewBusy || proofReviewNote.trim().length < 3} style={{ padding: "10px 12px", borderRadius: 8, border: 0, background: "rgba(22,101,52,1)", color: "white", fontWeight: 900, opacity: proofReviewBusy || proofReviewNote.trim().length < 3 ? .45 : 1 }}>
                          Approve proof
                        </button>
                        <button type="button" onClick={() => setPendingProofAction("REJECT")} disabled={proofReviewBusy || proofReviewNote.trim().length < 3} style={{ padding: "10px 12px", borderRadius: 8, border: 0, background: "rgba(185,28,28,1)", color: "white", fontWeight: 900, opacity: proofReviewBusy || proofReviewNote.trim().length < 3 ? .45 : 1 }}>
                          Reject proof
                        </button>
                        <button type="button" onClick={() => reviewTransferProof("REQUEST_INFORMATION")} disabled={proofReviewBusy || proofReviewNote.trim().length < 3} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(37,99,235,.35)", background: "white", color: "rgba(6,74,147,1)", fontWeight: 900, opacity: proofReviewBusy || proofReviewNote.trim().length < 3 ? .45 : 1 }}>
                          Request more information
                        </button>
                      </div>
                      {pendingProofAction ? (
                        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,.14)", background: "white" }}>
                          <strong>Confirm {pendingProofAction === "APPROVE" ? "approval" : "rejection"}?</strong>
                          <div style={{ marginTop: 4, fontSize: 13 }}>
                            {pendingProofAction === "APPROVE" ? "This removes the review from the queue and asks the buyer to confirm receipt." : "This removes the review from the queue and asks the seller to upload corrected proof."}
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button type="button" onClick={() => reviewTransferProof(pendingProofAction)} disabled={proofReviewBusy} style={{ padding: "8px 11px", borderRadius: 8, border: 0, background: pendingProofAction === "APPROVE" ? "rgba(22,101,52,1)" : "rgba(185,28,28,1)", color: "white", fontWeight: 900 }}>
                              {proofReviewBusy ? "Applying..." : "Yes, apply decision"}
                            </button>
                            <button type="button" onClick={() => setPendingProofAction(null)} disabled={proofReviewBusy} style={{ padding: "8px 11px", borderRadius: 8, border: "1px solid rgba(0,0,0,.14)", background: "white", fontWeight: 900 }}>Cancel</button>
                          </div>
                        </div>
                      ) : null}
                      {proofReviewResult ? <div role="status" aria-live="polite" style={{ marginTop: 9, fontWeight: 800, color: proofReviewResult.startsWith("Review failed") || proofReviewResult.startsWith("Enter") ? "rgba(153,27,27,1)" : "rgba(22,101,52,1)" }}>{proofReviewResult}</div> : null}
                    </div>
                  ) : null}
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Transfer proof</div>
                    <div style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", display: "grid", gap: 6 }}>
                      <div><strong>File:</strong> {transferProof.fileName || "-"}</div>
                      <div><strong>Seller note:</strong> {transferProof.sellerNote || "-"}</div>
                      <div><strong>Reviewed:</strong> {transferProof.reviewedAt ? new Date(transferProof.reviewedAt).toLocaleString() : "-"}</div>
                      {transferProof.manualReviewRequestedAt ? (
                        <div><strong>Human review requested:</strong> {new Date(transferProof.manualReviewRequestedAt).toLocaleString()}</div>
                      ) : null}
                      {(transferProof.adminReviews || []).map((review, index) => (
                        <div key={review.id || index}>
                          <strong>Admin {review.action?.toLowerCase().replaceAll("_", " ") || "review"}:</strong> {review.note || "-"}{review.decidedAt ? ` — ${new Date(review.decidedAt).toLocaleString()}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                  {isImageProof ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proofUpload} alt="Transfer proof upload" style={{ maxWidth: 520, width: "100%", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }} />
                  ) : null}
                  {isPdfProof ? (
                    <a
                      href={`/api/admin/orders/${encodeURIComponent(id)}/transfer-proof`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "underline", fontWeight: 900 }}
                    >
                      Open transfer proof PDF
                    </a>
                  ) : null}
                  <JsonBlock value={transferProof.review ?? null} />
                </div>
              );
            })() : null}
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Listings In This Transaction</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {order.items.map((item: any) => {
                const receiptProof = item.ticket?.receiptReview ?? null;
                const receiptUpload = item.ticket?.verificationImage ?? null;
                const isImageReceipt = typeof receiptUpload === "string" && /^data:image\//i.test(receiptUpload);
                const isPdfReceipt = typeof receiptUpload === "string" && /^data:application\/pdf/i.test(receiptUpload);
                return (
                  <div key={item.id} style={{ padding: 12, borderRadius: 8, background: "rgba(248,250,252,1)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <strong>{item.ticket?.title || item.ticketId}</strong>
                        <div style={{ opacity: 0.75, fontSize: 13 }}>{item.ticket?.venue} | {item.ticket?.date} | Row {item.ticket?.row || "-"} Seat {item.ticket?.seat || "-"}</div>
                        <div style={{ opacity: 0.75, fontSize: 13 }}>Verification: {item.ticket?.verificationStatus} {item.ticket?.verificationScore != null ? `(${item.ticket.verificationScore})` : ""}</div>
                      </div>
                      <Link href={`/admin/tickets/${encodeURIComponent(item.ticketId)}`} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(37,99,235,0.22)", background: "white", color: "inherit", textDecoration: "none", fontWeight: 800 }}>Review listing</Link>
                    </div>
                    {receiptProof ? (
                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 900 }}>Receipt: {receiptProof.fileName || "uploaded receipt"}</div>
                        {isImageReceipt ? <img src={receiptUpload} alt="Uploaded receipt" style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, border: "1px solid rgba(0,0,0,0.10)" }} /> : null}
                        {isPdfReceipt ? <a href={receiptUpload} download={receiptProof.fileName || "receipt.pdf"} style={{ textDecoration: "underline" }}>Open uploaded PDF receipt</a> : null}
                        <details>
                          <summary style={{ cursor: "pointer", fontWeight: 800 }}>OCR and pricing evidence</summary>
                          <div style={{ marginTop: 8 }}>
                            <JsonBlock value={{ receipt: receiptProof?.ocr ?? receiptProof, officialPricingSync: item.ticket?.officialPricingSync ?? null }} />
                          </div>
                        </details>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>No receipt evidence stored for this listing.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
