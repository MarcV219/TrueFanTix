"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
};

function parseDisputeRecord(value: unknown): DisputeRecord | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as DisputeRecord & { dispute?: DisputeRecord };
    if (parsed?.type === "BUYER_DISPUTE") return parsed;
    const nested = parsed?.dispute;
    return nested?.type === "BUYER_DISPUTE" ? nested : null;
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

  async function resolveDispute(action: "RELEASE_PAYOUT" | "MARK_REFUND_REQUIRED" | "KEEP_UNDER_REVIEW") {
    setDecisionBusy(true);
    setError(null);
    setDecisionMessage(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/resolve-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: decisionNote }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Could not resolve dispute.");
      setDecisionMessage(json.message || "Dispute updated.");
      setDecisionNote("");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not resolve dispute.");
    } finally {
      setDecisionBusy(false);
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
                    {disputeEvidenceFiles.map((file, index) => (
                      <a
                        key={`${file.fileName || "dispute-evidence"}-${index}`}
                        href={file.data}
                        download={file.fileName || `dispute-evidence-${index + 1}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 900, textDecoration: "underline" }}
                      >
                        Open supporting document {index + 1}
                        {file.fileName ? `: ${file.fileName}` : ""}
                      </a>
                    ))}
                    {(disputeRecord.submissions || []).map((submission, submissionIndex) => (
                      <div key={submission.id || submissionIndex} style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,.12)", background: "white" }}>
                        <div style={{ fontWeight: 900 }}>
                          {submission.submittedByRole || "Party"} update
                          {submission.submittedAt ? ` — ${new Date(submission.submittedAt).toLocaleString()}` : ""}
                        </div>
                        <div style={{ marginTop: 5, whiteSpace: "pre-wrap" }}>{submission.comments || "(documents only)"}</div>
                        {(submission.evidenceFiles || []).map((file, fileIndex) => file.data ? (
                          <a key={`${file.fileName}-${fileIndex}`} href={file.data} download={file.fileName || `dispute-update-${fileIndex + 1}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6, fontWeight: 900, textDecoration: "underline" }}>
                            Open document: {file.fileName || `Attachment ${fileIndex + 1}`}
                          </a>
                        ) : null)}
                      </div>
                    ))}
                  </div>
                ) : null}
                <textarea
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  rows={4}
                  placeholder="Admin decision note"
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => resolveDispute("KEEP_UNDER_REVIEW")}
                    disabled={decisionBusy || decisionNote.trim().length < 3}
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.16)", background: "white", fontWeight: 900 }}
                  >
                    Keep under review
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveDispute("MARK_REFUND_REQUIRED")}
                    disabled={decisionBusy || decisionNote.trim().length < 3}
                    style={{ padding: "10px 12px", borderRadius: 8, border: 0, background: "rgba(185,28,28,1)", color: "white", fontWeight: 900 }}
                  >
                    Mark refund required
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveDispute("RELEASE_PAYOUT")}
                    disabled={decisionBusy || decisionNote.trim().length < 3}
                    style={{ padding: "10px 12px", borderRadius: 8, border: 0, background: "rgba(22,101,52,1)", color: "white", fontWeight: 900 }}
                  >
                    Release seller payout
                  </button>
                </div>
                {decisionMessage ? <div style={{ marginTop: 10, color: "rgba(22,101,52,1)", fontWeight: 800 }}>{decisionMessage}</div> : null}
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
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Transfer proof</div>
                    <div style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", display: "grid", gap: 6 }}>
                      <div><strong>File:</strong> {transferProof.fileName || "-"}</div>
                      <div><strong>Seller note:</strong> {transferProof.sellerNote || "-"}</div>
                      <div><strong>Reviewed:</strong> {transferProof.reviewedAt ? new Date(transferProof.reviewedAt).toLocaleString() : "-"}</div>
                    </div>
                  </div>
                  {isImageProof ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={proofUpload} alt="Transfer proof upload" style={{ maxWidth: 520, width: "100%", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }} />
                  ) : null}
                  {isPdfProof ? (
                    <a href={proofUpload} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", fontWeight: 900 }}>
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
