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

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [order, setOrder] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
              <Field label="Transfer Verification" value={`${order.transferVerificationStatus || "-"} ${order.transferVerificationReason || ""}`} />
              <Field label="Buyer Confirmation" value={`${order.buyerConfirmationStatus || "-"} ${order.buyerConfirmationAt ? new Date(order.buyerConfirmationAt).toLocaleString() : ""}`} />
            </div>
            {order.transferProofData ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>Transfer proof data</div>
                <div style={{ padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)", overflowWrap: "anywhere" }}>{order.transferProofData}</div>
              </div>
            ) : null}
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
