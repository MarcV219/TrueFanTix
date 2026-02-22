"use client";

import React from "react";
import Link from "next/link";
import AccountGate, { MeUser } from "@/app/account/_components/accountgate";

type CreateTicketBody = {
  title: string;
  priceCents: number;
  faceValueCents?: number | null;
  image: string;
  venue: string;
  date: string; // keep string for now (matches schema)
  eventId?: string | null;
  barcodeData?: string | null;
  barcodeType?: string | null;
};

type TicketRow = {
  id: string;
  title: string;
  price: number;
  faceValue: number | null;
  image: string;
  venue: string;
  date: string;
  status: string;
  verificationStatus?: "PENDING" | "VERIFIED" | "REJECTED" | "NEEDS_REVIEW" | string;
  verificationScore?: number | null;
  verificationReason?: string | null;
};

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
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

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>{title}</div>
        {description ? <div style={{ opacity: 0.82 }}>{description}</div> : null}
      </div>
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

function inputStyle(focused: boolean): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 10,
    border: focused ? "1px solid rgba(37, 99, 235, 0.65)" : "1px solid rgba(148, 163, 184, 0.9)",
    background: "rgba(248, 250, 252, 1)",
    color: "rgba(15, 23, 42, 1)",
    outline: "none",
    boxShadow: focused ? "0 0 0 3px rgba(37, 99, 235, 0.18)" : "none",
  };
}

function parseDollarsToCents(v: string): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;

  // dollars -> cents, ensure integer cents
  return Math.round(n * 100);
}

function parseOptionalDollarsToCents(v: string): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;

  return Math.round(n * 100);
}

function formatMoney(n: number) {
  // no Intl needed for MVP; keep stable formatting
  return `$${Number(n).toFixed(2)}`;
}

function ListingRow({ t }: { t: TicketRow }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr auto",
        gap: 12,
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        alignItems: "center",
      }}
    >
      <img
        src={t.image}
        alt=""
        style={{
          width: 80,
          height: 80,
          borderRadius: 10,
          objectFit: "cover",
          border: "1px solid rgba(0,0,0,0.08)",
          background: "rgba(248,250,252,1)",
        }}
      />

      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontWeight: 950 }}>{t.title}</div>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          {t.venue} • {t.date}
        </div>
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 900 }}>{formatMoney(t.price)}</span>
          {t.faceValue != null ? (
            <span style={{ opacity: 0.7 }}> (Face {formatMoney(t.faceValue)})</span>
          ) : null}
        </div>
      </div>

      <div style={{ justifySelf: "end", display: "grid", gap: 6, justifyItems: "end" }}>
        <div
          style={{
            display: "inline-flex",
            padding: "6px 10px",
            borderRadius: 999,
            border:
              t.status === "AVAILABLE"
                ? "1px solid rgba(34,197,94,0.35)"
                : "1px solid rgba(148,163,184,0.55)",
            background: t.status === "AVAILABLE" ? "rgba(240,253,244,1)" : "rgba(248,250,252,1)",
            fontWeight: 950,
            fontSize: 12,
          }}
        >
          {t.status}
        </div>

        <div
          style={{
            display: "inline-flex",
            padding: "6px 10px",
            borderRadius: 999,
            border:
              t.verificationStatus === "VERIFIED"
                ? "1px solid rgba(34,197,94,0.35)"
                : t.verificationStatus === "REJECTED"
                ? "1px solid rgba(239,68,68,0.4)"
                : t.verificationStatus === "NEEDS_REVIEW"
                ? "1px solid rgba(245,158,11,0.45)"
                : "1px solid rgba(148,163,184,0.55)",
            background:
              t.verificationStatus === "VERIFIED"
                ? "rgba(240,253,244,1)"
                : t.verificationStatus === "REJECTED"
                ? "rgba(254,242,242,1)"
                : t.verificationStatus === "NEEDS_REVIEW"
                ? "rgba(255,251,235,1)"
                : "rgba(248,250,252,1)",
            fontWeight: 900,
            fontSize: 12,
          }}
          title={t.verificationReason ?? undefined}
        >
          Verify: {t.verificationStatus ?? "PENDING"}
          {typeof t.verificationScore === "number" ? ` (${t.verificationScore})` : ""}
        </div>
      </div>
    </div>
  );
}

function ActiveListings({
  me,
  refreshKey,
  sellerApproved,
}: {
  me: MeUser;
  refreshKey: number;
  sellerApproved: boolean;
}) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tickets, setTickets] = React.useState<TicketRow[]>([]);

  const sellerId = (me as any)?.sellerId as string | null | undefined;

  React.useEffect(() => {
    let alive = true;

    async function load() {
      setError(null);
      setLoading(true);

      // If not approved yet, don’t spam calls; show empty state.
      if (!sellerApproved || !sellerId) {
        if (alive) {
          setTickets([]);
          setLoading(false);
        }
        return;
      }

      try {
        const { res, data } = await fetchJson(`/api/tickets?sellerId=${encodeURIComponent(sellerId)}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok || !data?.ok) {
          const msg = (data && (data.message || data.error || data.details)) || `Failed to load listings (${res.status}).`;
          throw new Error(String(msg));
        }

        const list = Array.isArray(data?.tickets) ? (data.tickets as TicketRow[]) : [];
        if (alive) setTickets(list);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Failed to load listings.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [sellerApproved, sellerId, refreshKey]);

  if (!sellerApproved) {
    return (
      <div style={{ opacity: 0.85 }}>
        Active listings will appear here once seller verification is complete.
      </div>
    );
  }

  if (loading) {
    return <div style={{ opacity: 0.8 }}>Loading your active listings…</div>;
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
          fontWeight: 700,
        }}
      >
        {error}
      </div>
    );
  }

  if (tickets.length === 0) {
    return <div style={{ opacity: 0.85 }}>No active listings yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {tickets.map((t) => (
        <ListingRow key={t.id} t={t} />
      ))}
    </div>
  );
}

function Body({ me }: { me: MeUser }) {
  const displayName = me?.displayName?.trim() || `${me.firstName} ${me.lastName}`;

  const emailVerified = !!me?.emailVerifiedAt;
  const phoneVerified = !!me?.phoneVerifiedAt;

  // This is your “real” selling gate: comes from /api/auth/me (DB + seller.status)
  const sellerApproved = !!me?.flags?.isSellerApproved;

  // Force refresh for listings
  const [refreshKey, setRefreshKey] = React.useState(0);

  // form state
  const [title, setTitle] = React.useState("");
  const [venue, setVenue] = React.useState("");
  const [date, setDate] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [faceValue, setFaceValue] = React.useState("");
  const [image, setImage] = React.useState("");
  const [barcodeData, setBarcodeData] = React.useState("");
  const [barcodeType, setBarcodeType] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  // focus state (obvious boxes)
  const [fTitle, setFTitle] = React.useState(false);
  const [fVenue, setFVenue] = React.useState(false);
  const [fDate, setFDate] = React.useState(false);
  const [fPrice, setFPrice] = React.useState(false);
  const [fFace, setFFace] = React.useState(false);
  const [fImage, setFImage] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!sellerApproved) {
      setError("Seller verification is required before listing tickets.");
      return;
    }

    const t = title.trim();
    const v = venue.trim();
    const d = date.trim();
    const img = image.trim();

    if (!t) return setError("Title is required.");
    if (!v) return setError("Venue is required.");
    if (!d) return setError("Date is required.");
    if (!img) return setError("Image URL/path is required.");

    const priceCents = parseDollarsToCents(price);
    if (priceCents == null) return setError("Price must be a number greater than 0.");

    const faceValueCents = parseOptionalDollarsToCents(faceValue);
    if (faceValue.trim() && faceValueCents == null) {
      return setError("Face value must be a number greater than 0 (or leave blank).");
    }

    const body: CreateTicketBody = {
      title: t,
      venue: v,
      date: d,
      image: img,
      priceCents,
      faceValueCents: faceValueCents ?? null,
      barcodeData: barcodeData.trim() || null,
      barcodeType: barcodeType.trim() || null,
    };

    setBusy(true);
    try {
      // ✅ Use your existing backend route
      const { res, data } = await fetchJson("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg =
          (data && (data.message || data.error || data.details)) ||
          `Create listing failed (${res.status}).`;
        setError(String(msg));
        return;
      }

      setOk("Ticket listed successfully.");
      setTitle("");
      setVenue("");
      setDate("");
      setPrice("");
      setFaceValue("");
      setImage("");
      setBarcodeData("");
      setBarcodeType("");

      // ✅ Refresh listings after create
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setError(err?.message ?? "Create listing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="Seller status" description="You must be fully verified (email + phone + Stripe) to list tickets.">
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 800 }}>
            Signed in as: <span style={{ opacity: 0.85 }}>{displayName}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                border: emailVerified
                  ? "1px solid rgba(34,197,94,0.35)"
                  : "1px solid rgba(148,163,184,0.55)",
                background: emailVerified ? "rgba(240,253,244,1)" : "rgba(248,250,252,1)",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              {emailVerified ? "✓" : "•"} Email verified
            </span>

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                border: phoneVerified
                  ? "1px solid rgba(34,197,94,0.35)"
                  : "1px solid rgba(148,163,184,0.55)",
                background: phoneVerified ? "rgba(240,253,244,1)" : "rgba(248,250,252,1)",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              {phoneVerified ? "✓" : "•"} Phone verified
            </span>

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                border: sellerApproved
                  ? "1px solid rgba(34,197,94,0.35)"
                  : "1px solid rgba(148,163,184,0.55)",
                background: sellerApproved ? "rgba(240,253,244,1)" : "rgba(248,250,252,1)",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              {sellerApproved ? "✓" : "•"} Seller approved
            </span>
          </div>

          {!sellerApproved ? (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(148,163,184,0.45)",
                  background: "rgba(248,250,252,1)",
                  fontWeight: 850,
                  color: "rgba(15,23,42,0.85)",
                }}
              >
                Selling is locked until seller verification is complete.
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/account"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.10)",
                    background: "rgba(248, 250, 252, 1)",
                    color: "rgba(15, 23, 42, 1)",
                    fontWeight: 900,
                    textDecoration: "none",
                  }}
                >
                  Go to verification
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* ✅ NEW: Active listings */}
      <Card
        title="My active listings"
        description="These are your current tickets (pulled from GET /api/tickets?sellerId=...). Verification states: PENDING, VERIFIED, NEEDS_REVIEW, REJECTED. Public marketplace only shows VERIFIED."
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={!sellerApproved}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: !sellerApproved ? "rgba(148, 163, 184, 0.18)" : "rgba(15, 23, 42, 0.92)",
              color: !sellerApproved ? "rgba(15,23,42,0.55)" : "white",
              fontWeight: 950,
              cursor: !sellerApproved ? "not-allowed" : "pointer",
            }}
          >
            Refresh listings
          </button>
        </div>

        <ActiveListings me={me} refreshKey={refreshKey} sellerApproved={sellerApproved} />
      </Card>

      <Card
        title="List a ticket"
        description="This creates a real Ticket record via POST /api/tickets (in cents)."
      >
        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,0,0,0.35)",
              background: "rgba(254, 242, 242, 1)",
              color: "rgba(153, 27, 27, 1)",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}

        {ok ? (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(34, 197, 94, 0.35)",
              background: "rgba(240, 253, 244, 1)",
              color: "rgba(22, 101, 52, 1)",
              fontWeight: 800,
            }}
          >
            {ok}
          </div>
        ) : null}

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              placeholder='e.g., "Taylor Swift — Floor Seat"'
              style={inputStyle(fTitle)}
              onFocus={() => setFTitle(true)}
              onBlur={() => setFTitle(false)}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Venue</span>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              disabled={busy}
              placeholder='e.g., "Rogers Centre"'
              style={inputStyle(fVenue)}
              onFocus={() => setFVenue(true)}
              onBlur={() => setFVenue(false)}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Date</span>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Use your current string format (example: 2026-08-14 7:30 PM)
            </div>
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
              placeholder="YYYY-MM-DD 7:30 PM"
              style={inputStyle(fDate)}
              onFocus={() => setFDate(true)}
              onBlur={() => setFDate(false)}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Price (dollars)</span>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Enter dollars (we convert to cents automatically)
            </div>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={busy}
              inputMode="decimal"
              placeholder="150"
              style={inputStyle(fPrice)}
              onFocus={() => setFPrice(true)}
              onBlur={() => setFPrice(false)}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Face value (optional, dollars)</span>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Enter dollars, or leave blank</div>
            <input
              value={faceValue}
              onChange={(e) => setFaceValue(e.target.value)}
              disabled={busy}
              inputMode="decimal"
              placeholder="150"
              style={inputStyle(fFace)}
              onFocus={() => setFFace(true)}
              onBlur={() => setFFace(false)}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Image URL/path</span>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              For now: a public URL or an existing /public path (example: /tickets/sample.jpg)
            </div>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              disabled={busy}
              placeholder="https://... or /tickets/..."
              style={inputStyle(fImage)}
              onFocus={() => setFImage(true)}
              onBlur={() => setFImage(false)}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Barcode payload (optional)</span>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Paste decoded barcode/token text from your ticket proof for stronger authenticity checks.
            </div>
            <textarea
              value={barcodeData}
              onChange={(e) => setBarcodeData(e.target.value)}
              disabled={busy}
              placeholder="Paste barcode/QR payload"
              rows={3}
              style={{ ...inputStyle(false), resize: "vertical" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Barcode type (optional)</span>
            <input
              value={barcodeType}
              onChange={(e) => setBarcodeType(e.target.value)}
              disabled={busy}
              placeholder="e.g., QR, PDF417, AZTEC"
              style={inputStyle(false)}
            />
          </label>

          <button
            type="submit"
            disabled={busy || !sellerApproved}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background:
                busy || !sellerApproved
                  ? "rgba(148, 163, 184, 0.18)"
                  : "rgba(15, 23, 42, 0.92)",
              color: busy || !sellerApproved ? "rgba(15,23,42,0.55)" : "white",
              fontWeight: 950,
              cursor: busy || !sellerApproved ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Listing…" : !sellerApproved ? "Seller verification required" : "List ticket"}
          </button>
        </form>
      </Card>

      <Card title="Coming next" description="Next we’ll add edit + withdraw actions (real backend).">
        <div style={{ opacity: 0.85 }}>
          Next we’ll add:
          <ul style={{ marginTop: 8 }}>
            <li>Withdraw listing (AVAILABLE → WITHDRAWN)</li>
            <li>Edit listing (price/title/image)</li>
            <li>Seller dashboard metrics</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

export default function SellingTicketsPage() {
  return (
    <Shell title="Tickets — Selling">
      <AccountGate
        nextPath="/account/tickets/selling"
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
        {(me) => <Body me={me} />}
      </AccountGate>
    </Shell>
  );
}
