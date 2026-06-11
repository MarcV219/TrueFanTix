"use client";

import React from "react";
import Link from "next/link";
import AccountGate, { MeUser } from "@/app/account/_components/accountgate";
import { fetchJson } from "@/lib/api-fetch";

type CreateTicketBody = {
  title: string;
  priceCents: number;
  faceValueCents?: number | null;
  image: string;
  venue: string;
  date: string; // keep string for now (matches schema)
  row?: string | null;
  seat?: string | null;
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
  row?: string | null;
  seat?: string | null;
  status: string;
  verificationStatus?: "PENDING" | "VERIFIED" | "REJECTED" | "NEEDS_REVIEW" | string;
  verificationScore?: number | null;
  verificationReason?: string | null;
};

type CatalogSuggestion = {
  type: "ARTIST" | "TEAM" | "VENUE" | "CITY" | "SPORT";
  value: string;
  label: string;
  catalogEntityId?: string;
  canonicalName?: string;
  provider?: string;
  subtitle?: string;
  aliases?: string[];
};

type SeatingInfo = {
  row: string;
  seat: string;
};

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

function formatTicketDateTime(v: string): string {
  const raw = String(v ?? "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return raw;

  const [, datePart, hourPart, minutePart] = match;
  const hour24 = Number(hourPart);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${datePart} ${hour12}:${minutePart} ${period}`;
}

function formatMoney(n: number) {
  // no Intl needed for MVP; keep stable formatting
  return `$${Number(n).toFixed(2)}`;
}

function catalogSuggestionMeta(suggestion: CatalogSuggestion) {
  return [suggestion.type, suggestion.subtitle, suggestion.provider].filter(Boolean).join(" • ");
}

function wordsForSearch(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function suggestionMatchesTypedValue(suggestion: CatalogSuggestion, typedValue: string) {
  const queryWords = wordsForSearch(typedValue);
  if (queryWords.length === 0) return true;

  const candidateWords = [
    suggestion.label,
    suggestion.value,
    suggestion.canonicalName,
    suggestion.subtitle,
    ...(suggestion.aliases ?? []),
  ].flatMap((part) => wordsForSearch(part ?? ""));

  return queryWords.every((queryWord) => candidateWords.some((candidateWord) => candidateWord.startsWith(queryWord)));
}

function uniqueCatalogSuggestions(items: CatalogSuggestion[]) {
  const seen = new Set<string>();
  const unique: CatalogSuggestion[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function normalizeTicketQuantity(v: string) {
  const parsed = Number(v);
  if (!Number.isInteger(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 20);
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
        {(t.row || t.seat) ? (
          <div style={{ fontSize: 13, opacity: 0.78 }}>
            {[t.row ? `Row ${t.row}` : null, t.seat ? `Seat ${t.seat}` : null].filter(Boolean).join(" • ")}
          </div>
        ) : null}
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
          const details = Array.isArray(data?.details) ? data.details : null;
          const msg =
            (data && (data.message || data.error)) ||
            (details && details.length ? details[0] : null) ||
            `Failed to load listings (${res.status}).`;
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
  const [selectedTitleSuggestion, setSelectedTitleSuggestion] = React.useState<CatalogSuggestion | null>(null);
  const [titleSuggestions, setTitleSuggestions] = React.useState<CatalogSuggestion[]>([]);
  const [titleRequestType, setTitleRequestType] = React.useState<"ARTIST" | "TEAM" | "SPORT">("ARTIST");
  const [venue, setVenue] = React.useState("");
  const [selectedVenueSuggestion, setSelectedVenueSuggestion] = React.useState<CatalogSuggestion | null>(null);
  const [venueSuggestions, setVenueSuggestions] = React.useState<CatalogSuggestion[]>([]);
  const [ticketQuantity, setTicketQuantity] = React.useState("1");
  const [isGeneralAdmission, setIsGeneralAdmission] = React.useState(false);
  const [seating, setSeating] = React.useState<SeatingInfo[]>([{ row: "", seat: "" }]);
  const [date, setDate] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [faceValue, setFaceValue] = React.useState("");
  const [image, setImage] = React.useState("");
  const [barcodeData, setBarcodeData] = React.useState("");
  const [barcodeType, setBarcodeType] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [requestBusy, setRequestBusy] = React.useState<"title" | "venue" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  // focus state (obvious boxes)
  const [fTitle, setFTitle] = React.useState(false);
  const [fVenue, setFVenue] = React.useState(false);
  const [fQuantity, setFQuantity] = React.useState(false);
  const [fDate, setFDate] = React.useState(false);
  const [fPrice, setFPrice] = React.useState(false);
  const [fFace, setFFace] = React.useState(false);
  const [fImage, setFImage] = React.useState(false);

  React.useEffect(() => {
    const q = title.trim();
    if (q.length < 2) {
      setTitleSuggestions([]);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const results = await Promise.all(
          ["ARTIST", "TEAM", "SPORT"].map(async (type) => {
            const params = new URLSearchParams({ q, type, limit: "50", providers: "0" });
            const res = await fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" });
            const data = await res.json();
            return Array.isArray(data?.suggestions) ? (data.suggestions as CatalogSuggestion[]) : [];
          })
        );
        if (alive) {
          setTitleSuggestions(uniqueCatalogSuggestions(results.flat()));
        }
      } catch {
        if (alive) setTitleSuggestions([]);
      }
    }, 160);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [title]);

  React.useEffect(() => {
    const nextQuantity = normalizeTicketQuantity(ticketQuantity);
    setSeating((current) =>
      Array.from({ length: nextQuantity }, (_, index) => current[index] ?? { row: "", seat: "" })
    );
  }, [ticketQuantity]);

  React.useEffect(() => {
    const q = venue.trim();
    if (q.length < 2) {
      setVenueSuggestions([]);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, type: "VENUE", limit: "50" });
        const res = await fetch(`/api/catalog/suggestions?${params.toString()}`, { cache: "no-store" });
        const data = await res.json();
        if (alive) setVenueSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch {
        if (alive) setVenueSuggestions([]);
      }
    }, 160);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [venue]);

  const trimmedTitle = title.trim();
  const trimmedVenue = venue.trim();
  const visibleTitleSuggestions = React.useMemo(
    () => titleSuggestions.filter((suggestion) => suggestionMatchesTypedValue(suggestion, trimmedTitle)),
    [titleSuggestions, trimmedTitle]
  );
  const visibleVenueSuggestions = React.useMemo(
    () => venueSuggestions.filter((suggestion) => suggestionMatchesTypedValue(suggestion, trimmedVenue)),
    [venueSuggestions, trimmedVenue]
  );
  const validTitleSuggestion =
    !!selectedTitleSuggestion &&
    selectedTitleSuggestion.label === trimmedTitle &&
    suggestionMatchesTypedValue(selectedTitleSuggestion, trimmedTitle);
  const validVenueSuggestion =
    !!selectedVenueSuggestion &&
    selectedVenueSuggestion.type === "VENUE" &&
    selectedVenueSuggestion.label === trimmedVenue &&
    suggestionMatchesTypedValue(selectedVenueSuggestion, trimmedVenue);

  async function requestCatalogAddition(kind: "title" | "venue") {
    const requestValue = (kind === "title" ? title : venue).trim();
    if (requestValue.length < 2) {
      setError(kind === "title" ? "Type the missing artist, team, or sport before requesting an addition." : "Type the missing venue before requesting an addition.");
      setOk(null);
      return;
    }

    setRequestBusy(kind);
    setError(null);
    setOk(null);
    try {
      const { res, data } = await fetchJson("/api/catalog/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: kind === "title" ? titleRequestType : "VENUE",
          value: requestValue,
          notes: "Requested from the List Tickets form.",
        }),
      });

      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.message || data?.error || "Could not submit catalog request."));
      }

      setOk("Request sent. TrueFanTix will research it and add it to the catalog when it is verified.");
      if (kind === "title") {
        setTitle("");
        setSelectedTitleSuggestion(null);
        setTitleSuggestions([]);
      } else {
        setVenue("");
        setSelectedVenueSuggestion(null);
        setVenueSuggestions([]);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not submit catalog request.");
    } finally {
      setRequestBusy(null);
    }
  }

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
    const quantity = normalizeTicketQuantity(ticketQuantity);
    const d = formatTicketDateTime(date);
    const img = image.trim();
    const seatingForSubmit = isGeneralAdmission
      ? Array.from({ length: quantity }, () => ({ row: "General Admission", seat: "" }))
      : seating.slice(0, quantity).map((item) => ({
          row: item.row.trim(),
          seat: item.seat.trim(),
    }));

    if (!t) return setError("Title is required.");
    if (!v) return setError("Venue is required.");
    if (!validTitleSuggestion) return setError("Choose a verified artist, team, or sport from the list before listing tickets.");
    if (!validVenueSuggestion) return setError("Choose a verified venue from the list before listing tickets.");
    if (String(quantity) !== ticketQuantity.trim()) return setError("Ticket quantity must be a whole number from 1 to 20.");
    if (!isGeneralAdmission) {
      const missingSeatIndex = seatingForSubmit.findIndex((item) => !item.row || !item.seat);
      if (missingSeatIndex !== -1) {
        return setError(`Row and seat are required for ticket ${missingSeatIndex + 1}.`);
      }
    }
    if (!d) return setError("Date is required.");
    if (!img) return setError("Image URL/path is required.");

    const priceCents = parseDollarsToCents(price);
    if (priceCents == null) return setError("Price must be a number greater than 0.");

    const faceValueCents = parseOptionalDollarsToCents(faceValue);
    if (faceValue.trim() && faceValueCents == null) {
      return setError("Face value must be a number greater than 0 (or leave blank).");
    }

    setBusy(true);
    try {
      for (let i = 0; i < quantity; i += 1) {
        const seatInfo = seatingForSubmit[i];
        const body: CreateTicketBody = {
          title: t,
          venue: v,
          date: d,
          image: img,
          row: seatInfo.row,
          seat: seatInfo.seat,
          priceCents,
          faceValueCents: faceValueCents ?? null,
          barcodeData: i === 0 ? barcodeData.trim() || null : null,
          barcodeType: i === 0 ? barcodeType.trim() || null : null,
        };

        const { res, data } = await fetchJson("/api/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const details = Array.isArray(data?.details) ? data.details : null;
          const msg =
            (data && (data.message || data.error)) ||
            (details && details.length ? details[0] : null) ||
            `Create listing ${i + 1} of ${quantity} failed (${res.status}).`;
          setError(String(msg));
          return;
        }
      }

      setOk(quantity === 1 ? "Ticket listed successfully." : `${quantity} tickets listed successfully.`);
      setTitle("");
      setSelectedTitleSuggestion(null);
      setTitleSuggestions([]);
      setVenue("");
      setSelectedVenueSuggestion(null);
      setVenueSuggestions([]);
      setTicketQuantity("1");
      setIsGeneralAdmission(false);
      setSeating([{ row: "", seat: "" }]);
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
            <span style={{ fontWeight: 900 }}>Artist, team, or sport</span>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSelectedTitleSuggestion(null);
              }}
              disabled={busy || !!requestBusy}
              placeholder='Start typing an artist, team, or sport...'
              style={inputStyle(fTitle)}
              onFocus={() => setFTitle(true)}
              onBlur={() => setFTitle(false)}
            />
            {fTitle && title.trim().length >= 2 ? (
              <div
                style={{
                  display: "grid",
                  maxHeight: 280,
                  overflowY: "auto",
                  border: "1px solid rgba(148, 163, 184, 0.45)",
                  borderRadius: 10,
                  background: "white",
                  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.10)",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 900,
                    opacity: 0.72,
                    borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
                  }}
                >
                  {visibleTitleSuggestions.length} possible match{visibleTitleSuggestions.length === 1 ? "" : "es"}
                </div>
                {visibleTitleSuggestions.length > 0 ? (
                  visibleTitleSuggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.type}:${suggestion.value}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedTitleSuggestion(suggestion);
                        setTitle(suggestion.label);
                        setTitleSuggestions([]);
                        setError(null);
                        setOk(null);
                      }}
                      disabled={busy || !!requestBusy}
                      style={{
                        display: "grid",
                        gap: 3,
                        padding: "10px 12px",
                        border: 0,
                        borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
                        background: selectedTitleSuggestion?.type === suggestion.type && selectedTitleSuggestion.value === suggestion.value ? "rgba(239, 246, 255, 1)" : "white",
                        color: "rgba(15, 23, 42, 1)",
                        textAlign: "left",
                        cursor: busy || requestBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 900 }}>{suggestion.label}</span>
                      <span style={{ fontSize: 12, opacity: 0.72 }}>{catalogSuggestionMeta(suggestion)}</span>
                    </button>
                  ))
                ) : selectedTitleSuggestion ? null : (
                  <div style={{ display: "grid", gap: 8, padding: "10px 12px", fontSize: 13 }}>
                    <div style={{ opacity: 0.72 }}>No verified artist, team, or sport match found.</div>
                    <label style={{ display: "grid", gap: 4, fontWeight: 800 }}>
                      Request as
                      <select
                        value={titleRequestType}
                        onChange={(e) => setTitleRequestType(e.target.value as "ARTIST" | "TEAM" | "SPORT")}
                        disabled={busy || !!requestBusy}
                        style={{ ...inputStyle(false), padding: 8 }}
                      >
                        <option value="ARTIST">Artist</option>
                        <option value="TEAM">Team</option>
                        <option value="SPORT">Sport</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => requestCatalogAddition("title")}
                      disabled={busy || !!requestBusy}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(37, 99, 235, 0.35)",
                        background: busy || requestBusy ? "rgba(148, 163, 184, 0.18)" : "rgba(239, 246, 255, 1)",
                        color: "rgba(30, 64, 175, 1)",
                        fontWeight: 900,
                        cursor: busy || requestBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      {requestBusy === "title" ? "Sending request..." : `Request this ${titleRequestType.toLowerCase()}`}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Venue</span>
            <input
              value={venue}
              onChange={(e) => {
                setVenue(e.target.value);
                setSelectedVenueSuggestion(null);
              }}
              disabled={busy || !!requestBusy}
              placeholder='Start typing a venue...'
              style={inputStyle(fVenue)}
              onFocus={() => setFVenue(true)}
              onBlur={() => setFVenue(false)}
            />
            {fVenue && venue.trim().length >= 2 ? (
              <div
                style={{
                  display: "grid",
                  maxHeight: 280,
                  overflowY: "auto",
                  border: "1px solid rgba(148, 163, 184, 0.45)",
                  borderRadius: 10,
                  background: "white",
                  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.10)",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 900,
                    opacity: 0.72,
                    borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
                  }}
                >
                  {visibleVenueSuggestions.length} possible match{visibleVenueSuggestions.length === 1 ? "" : "es"}
                </div>
                {visibleVenueSuggestions.length > 0 ? (
                  visibleVenueSuggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.type}:${suggestion.value}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedVenueSuggestion(suggestion);
                        setVenue(suggestion.label);
                        setVenueSuggestions([]);
                        setError(null);
                        setOk(null);
                      }}
                      disabled={busy || !!requestBusy}
                      style={{
                        display: "grid",
                        gap: 3,
                        padding: "10px 12px",
                        border: 0,
                        borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
                        background: selectedVenueSuggestion?.value === suggestion.value ? "rgba(239, 246, 255, 1)" : "white",
                        color: "rgba(15, 23, 42, 1)",
                        textAlign: "left",
                        cursor: busy || requestBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 900 }}>{suggestion.label}</span>
                      <span style={{ fontSize: 12, opacity: 0.72 }}>{catalogSuggestionMeta(suggestion)}</span>
                    </button>
                  ))
                ) : selectedVenueSuggestion ? null : (
                  <div style={{ display: "grid", gap: 8, padding: "10px 12px", fontSize: 13 }}>
                    <div style={{ opacity: 0.72 }}>No verified venue match found.</div>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => requestCatalogAddition("venue")}
                      disabled={busy || !!requestBusy}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(37, 99, 235, 0.35)",
                        background: busy || requestBusy ? "rgba(148, 163, 184, 0.18)" : "rgba(239, 246, 255, 1)",
                        color: "rgba(30, 64, 175, 1)",
                        fontWeight: 900,
                        cursor: busy || requestBusy ? "not-allowed" : "pointer",
                      }}
                    >
                      {requestBusy === "venue" ? "Sending request..." : "Request this venue"}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>How many tickets?</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={ticketQuantity}
              onChange={(e) => setTicketQuantity(e.target.value)}
              disabled={busy}
              style={inputStyle(fQuantity)}
              onFocus={() => setFQuantity(true)}
              onBlur={() => {
                setFQuantity(false);
                setTicketQuantity(String(normalizeTicketQuantity(ticketQuantity)));
              }}
            />
          </label>

          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: 10,
              border: "1px solid rgba(148, 163, 184, 0.45)",
              borderRadius: 10,
              background: "rgba(248, 250, 252, 1)",
              fontWeight: 900,
            }}
          >
            <input
              type="checkbox"
              checked={isGeneralAdmission}
              onChange={(e) => setIsGeneralAdmission(e.target.checked)}
              disabled={busy}
              style={{ width: 18, height: 18 }}
            />
            General Admission tickets
          </label>

          <div style={{ display: "grid", gap: 10 }}>
            <span style={{ fontWeight: 900 }}>Seating information</span>
            {isGeneralAdmission ? (
              <div
                style={{
                  padding: 10,
                  border: "1px solid rgba(148, 163, 184, 0.45)",
                  borderRadius: 10,
                  background: "rgba(248, 250, 252, 1)",
                  opacity: 0.82,
                  fontWeight: 800,
                }}
              >
                These listings will be marked as General Admission. No row or seat numbers are required.
              </div>
            ) : (
              seating.map((seatInfo, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 10,
                    padding: 10,
                    border: "1px solid rgba(148, 163, 184, 0.45)",
                    borderRadius: 10,
                    background: "rgba(248, 250, 252, 1)",
                  }}
                >
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>Ticket {index + 1} row</span>
                    <input
                      value={seatInfo.row}
                      onChange={(e) =>
                        setSeating((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, row: e.target.value } : item
                          )
                        )
                      }
                      disabled={busy}
                      placeholder="e.g., 12"
                      style={inputStyle(false)}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 900 }}>Ticket {index + 1} seat</span>
                    <input
                      value={seatInfo.seat}
                      onChange={(e) =>
                        setSeating((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, seat: e.target.value } : item
                          )
                        )
                      }
                      disabled={busy}
                      placeholder="e.g., 8"
                      style={inputStyle(false)}
                    />
                  </label>
                </div>
              ))
            )}
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 900 }}>Date and time</span>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Pick the event date and start time.
            </div>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
              step={60}
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
