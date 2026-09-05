"use client";

import React from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";
import { SellerReview, type Review, type Ticket } from "@/app/account/tickets/bought/page";
import { useLanguage } from "@/app/_components/language-provider";
import { fetchJson } from "@/lib/api-fetch";

type ReviewItem = {
  id: string;
  rating: number;
  content: string;
  status: string;
  createdAt: string;
  seller?: { id: string; name: string };
  reviewer?: { id: string; firstName: string; displayName: string | null };
  order: { id: string; items: Array<{ ticket: { title: string } }> };
};

type PendingOrder = {
  id: string;
  createdAt: string;
  seller: { id: string; name: string };
  items: Array<{
    priceCents: number;
    ticket: { id: string; title: string; venue: string; date: string; image: string; status: string };
  }>;
};

type ReviewsData = { written: ReviewItem[]; received: ReviewItem[]; pending: PendingOrder[] };

function Stars({ rating }: { rating: number }) {
  return <span aria-label={`${rating} out of 5 stars`} style={{ color: "#d97706", fontSize: 20 }}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 18, borderRadius: 10, background: "rgba(248,250,252,1)", opacity: 0.75 }}>{children}</div>;
}

function ReviewCard({ review, received, translatedContent }: { review: ReviewItem; received?: boolean; translatedContent?: string | null }) {
  const { language, t } = useLanguage();
  const person = received
    ? review.reviewer?.displayName || review.reviewer?.firstName || "Buyer"
    : review.seller?.name || "Seller";
  const event = review.order.items[0]?.ticket.title || "Completed order";

  return (
    <article style={{ padding: 14, borderRadius: 10, border: "1px solid rgba(0,0,0,.1)", background: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900 }}>{t(received ? `From ${person}` : `For ${person}`)}</div>
        <time style={{ fontSize: 12, opacity: 0.65 }}>
          {new Date(review.createdAt).toLocaleDateString(language === "fr" ? "fr-CA" : undefined, {
            year: "numeric",
            month: language === "fr" ? "long" : "numeric",
            day: "numeric",
          })}
        </time>
      </div>
      <div style={{ marginTop: 4, fontSize: 13, opacity: 0.7 }}>{event}</div>
      <div style={{ marginTop: 6 }}><Stars rating={review.rating} /></div>
      {language === "fr" && translatedContent === undefined ? (
        <p style={{ margin: "8px 0 0", opacity: 0.7 }}>Traduction de l’évaluation…</p>
      ) : (
        <p data-no-translate style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{translatedContent || review.content}</p>
      )}
      {language === "fr" && translatedContent && translatedContent !== review.content ? (
        <details data-no-translate style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
          <summary>Voir l’évaluation originale</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{review.content}</p>
        </details>
      ) : null}
    </article>
  );
}

function Section({ title, description, count, children }: { title: string; description: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(0,0,0,.1)", background: "white" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 950 }}>{title} <span style={{ opacity: 0.55 }}>({count})</span></h2>
      <p style={{ margin: "5px 0 14px", opacity: 0.75 }}>{description}</p>
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </section>
  );
}

export function ReviewsBody() {
  const { language } = useLanguage();
  const [data, setData] = React.useState<ReviewsData>({ written: [], received: [], pending: [] });
  const [translations, setTranslations] = React.useState<Record<string, string | null>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const { res, data: response } = await fetchJson("/api/account/reviews", { cache: "no-store" });
      if (!res.ok || !response?.ok) throw new Error(response?.message || "Could not load reviews.");
      setData(response.reviews as ReviewsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reviews.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (language !== "fr" || loading) return;
    const ids = [...data.received, ...data.written]
      .map((review) => review.id)
      .filter((id) => translations[id] === undefined)
      .slice(0, 20);
    if (ids.length === 0) return;
    let cancelled = false;
    void fetchJson("/api/account/reviews/translations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewIds: ids }),
    }).then(({ res, data: response }) => {
      if (cancelled) return;
      if (res.ok && response?.ok) {
        setTranslations((current) => ({
          ...current,
          ...Object.fromEntries(ids.map((id) => [id, response.translations?.[id] || null])),
        }));
      } else {
        setTranslations((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, null])) }));
      }
    }).catch(() => {
      if (!cancelled) setTranslations((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, null])) }));
    });
    return () => { cancelled = true; };
  }, [data.received, data.written, language, loading, translations]);

  if (loading) return <p style={{ opacity: 0.75 }}>Loading reviews…</p>;
  if (error) return <div role="alert" style={{ padding: 12, borderRadius: 10, background: "rgba(254,242,242,1)", color: "rgba(153,27,27,1)" }}>{error}</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section title="Waiting for your review" description="Completed purchases that still need your seller review." count={data.pending.length}>
        {data.pending.length === 0 ? <Empty>You’re all caught up—there are no sellers waiting for your review.</Empty> : data.pending.map((order) => {
          const first = order.items[0];
          if (!first) return null;
          const ticket: Ticket = {
            id: first.ticket.id,
            title: first.ticket.title,
            venue: first.ticket.venue,
            date: first.ticket.date,
            price: first.priceCents / 100,
            image: first.ticket.image,
            status: first.ticket.status,
            orderId: order.id,
            orderDate: order.createdAt,
            seller: order.seller,
            review: null,
          };
          return (
            <article key={order.id} style={{ padding: 16, borderRadius: 12, border: "2px solid rgba(217,119,6,.65)", background: "rgba(255,251,235,1)", boxShadow: "0 0 0 3px rgba(245,158,11,.12)" }}>
              <div style={{ display: "inline-flex", padding: "4px 8px", borderRadius: 999, background: "rgba(217,119,6,1)", color: "white", fontSize: 11, fontWeight: 950, textTransform: "uppercase" }}>Review needed</div>
              <h3 style={{ margin: "10px 0 2px", fontSize: 18 }}>{first.ticket.title}</h3>
              <div style={{ opacity: 0.75 }}>{first.ticket.venue} · Seller: {order.seller.name}{order.items.length > 1 ? ` · ${order.items.length} tickets` : ""}</div>
              <SellerReview ticket={ticket} onSubmitted={(_review: Review) => void load()} />
            </article>
          );
        })}
      </Section>

      <Section title="Reviews you’ve received" description="Feedback buyers have left for you as a seller." count={data.received.length}>
        {data.received.length === 0 ? <Empty>No buyer reviews received yet.</Empty> : data.received.map((review) => <ReviewCard key={review.id} review={review} received translatedContent={translations[review.id]} />)}
      </Section>

      <Section title="Reviews you’ve left" description="Your review history for completed purchases." count={data.written.length}>
        {data.written.length === 0 ? <Empty>You haven’t left any seller reviews yet.</Empty> : data.written.map((review) => <ReviewCard key={review.id} review={review} translatedContent={translations[review.id]} />)}
      </Section>
    </div>
  );
}

export default function AccountReviewsPage() {
  return (
    <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Reviews</h1>
      <p style={{ margin: "6px 0 18px" }}><Link href="/account" style={{ textDecoration: "underline" }}>← Back to Account</Link></p>
      <AccountGate nextPath="/account/reviews" loadingFallback={<p>Loading…</p>} errorFallback={(message) => <div role="alert">{message}</div>}>
        {() => <ReviewsBody />}
      </AccountGate>
    </div>
  );
}
