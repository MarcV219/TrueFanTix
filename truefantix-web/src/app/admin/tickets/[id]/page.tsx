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
    <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: "rgba(15,23,42,1)", color: "white", overflow: "auto", maxHeight: 420, fontSize: 12 }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AdminTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [ticket, setTicket] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load listing.");
      setTicket(json.ticket);
    } catch (err: any) {
      setError(err?.message || "Failed to load listing.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  const receiptProof = ticket?.receiptReview ?? null;
  const ocr = receiptProof?.ocr ?? null;
  const receiptUpload = ticket?.verificationImage || null;
  const isImageReceipt = typeof receiptUpload === "string" && /^data:image\//i.test(receiptUpload);
  const isPdfReceipt = typeof receiptUpload === "string" && /^data:application\/pdf/i.test(receiptUpload);
  const isUrlReceipt = typeof receiptUpload === "string" && /^https?:\/\//i.test(receiptUpload);

  return (
    <main style={{ maxWidth: 1180, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Admin - Listing Review</h1>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <Link href="/admin/tickets" style={{ textDecoration: "underline", opacity: 0.8 }}>Back to Listings</Link>
            <Link href="/admin/tickets/verification" style={{ textDecoration: "underline", opacity: 0.8 }}>Verification Queue</Link>
          </div>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "white", fontWeight: 800 }}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)", marginBottom: 12 }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Loading listing...</div> : null}

      {ticket ? (
        <div style={{ display: "grid", gap: 16 }}>
          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>{ticket.title}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
              <Field label="Listing ID" value={ticket.id} />
              <Field label="Status" value={`${ticket.status} / ${ticket.verificationStatus}`} />
              <Field label="Seller" value={`${ticket.seller?.name || "-"} ${ticket.seller?.user?.email ? `(${ticket.seller.user.email})` : ""}`} />
              <Field label="Event" value={`${ticket.venue} | ${ticket.date}`} />
              <Field label="Seats" value={`Row ${ticket.row || "-"} Seat ${ticket.seat || "-"}`} />
              <Field label="Price" value={money(ticket.priceCents, ticket.currency)} />
              <Field label="Face Value" value={money(ticket.faceValueCents, ticket.currency)} />
              <Field label="Eligible Fees" value={money(ticket.adminFeePaidCents, ticket.currency)} />
              <Field label="Max List Price" value={ticket.faceValueCents == null ? "-" : money(ticket.faceValueCents + Math.max(0, ticket.adminFeePaidCents || 0), ticket.currency)} />
              <Field label="Auto Verification" value={`${ticket.verificationProvider || "-"} ${ticket.verificationScore != null ? `(${ticket.verificationScore})` : ""}`} />
              <Field label="Created" value={new Date(ticket.createdAt).toLocaleString()} />
              <Field label="Vendor / Transfer" value={`${ticket.primaryVendor || "-"} / ${ticket.transferMethod || "-"}`} />
            </div>
            {ticket.verificationReason ? <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(255,251,235,1)" }}>{ticket.verificationReason}</div> : null}
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Receipt Upload</h2>
            <div style={{ marginBottom: 10, opacity: 0.75, fontSize: 13 }}>File: {receiptProof?.fileName || "-"}</div>
            {isImageReceipt ? <img src={receiptUpload} alt="Uploaded receipt" style={{ maxWidth: "100%", maxHeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.10)" }} /> : null}
            {isPdfReceipt ? (
              <object data={receiptUpload} type="application/pdf" style={{ width: "100%", minHeight: 720, border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8 }}>
                <a href={receiptUpload} download={receiptProof?.fileName || "receipt.pdf"}>Open uploaded PDF receipt</a>
              </object>
            ) : null}
            {isUrlReceipt ? <a href={receiptUpload} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Open uploaded receipt</a> : null}
            {!receiptUpload ? <div style={{ opacity: 0.75 }}>No receipt upload stored for this listing.</div> : null}
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Receipt OCR</h2>
              <JsonBlock value={ocr || receiptProof || {}} />
            </div>
            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Official Pricing Sync</h2>
              <JsonBlock value={ticket.officialPricingSync || {}} />
            </div>
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Orders / Transactions</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {ticket.orderItems.map((item: any) => (
                <Link key={item.id} href={`/admin/orders/${encodeURIComponent(item.order.id)}`} style={{ color: "inherit", textDecoration: "none", padding: 10, borderRadius: 8, background: "rgba(248,250,252,1)" }}>
                  <strong>{item.order.status}</strong> | {item.order.id} | {money(item.order.totalCents, item.order.currency)}
                </Link>
              ))}
              {ticket.orderItems.length === 0 ? <div style={{ opacity: 0.75 }}>No transactions for this listing yet.</div> : null}
            </div>
          </section>

          <section style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 8, background: "white", padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Raw Verification Evidence</h2>
            <JsonBlock value={ticket.parsedEvidence || ticket.verificationEvidence || {}} />
          </section>
        </div>
      ) : null}
    </main>
  );
}
