"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";
import { apiFetch } from "@/lib/api-fetch";

export type Review = {
  id: string;
  rating: number;
  content: string;
  createdAt: string;
};

export type Ticket = {
  id: string;
  title: string;
  venue: string;
  date: string;
  price: number;
  image: string;
  status: string;
  orderId: string;
  orderDate: string;
  seller: { id: string; name: string };
  review: Review | null;
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

function StarRating({ value, onChange, disabled = false }: { value: number; onChange?: (rating: number) => void; disabled?: boolean }) {
  return (
    <div role={onChange ? "radiogroup" : undefined} aria-label="Seller rating" style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role={onChange ? "radio" : undefined}
          aria-checked={onChange ? value === star : undefined}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          onClick={() => onChange?.(star)}
          disabled={disabled || !onChange}
          style={{
            padding: 2,
            border: 0,
            background: "transparent",
            color: star <= value ? "#d97706" : "#94a3b8",
            fontSize: 30,
            lineHeight: 1,
            cursor: disabled || !onChange ? "default" : "pointer",
          }}
        >
          {star <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

export function SellerReview({ ticket, onSubmitted }: { ticket: Ticket; onSubmitted: (review: Review) => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ticket.review) {
    return (
      <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "rgba(248, 250, 252, 1)", border: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ fontWeight: 800 }}>Your review of {ticket.seller.name}</div>
        <StarRating value={ticket.review.rating} />
        <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{ticket.review.content}</p>
      </div>
    );
  }

  async function submitReview(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (rating < 1) {
      setError("Choose a star rating before submitting your review.");
      return;
    }
    if (!comment.trim()) {
      setError("Add a comment about your experience with the seller.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ticket.orderId, rating, content: comment.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || "Could not submit your review.");
      onSubmitted(data.review as Review);
    } catch (err: any) {
      setError(err?.message || "Could not submit your review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submitReview} style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "rgba(239, 246, 255, 1)", border: "1px solid rgba(6, 74, 147, 0.18)" }}>
      <div style={{ fontWeight: 850 }}>Review seller {ticket.seller.name}</div>
      <p style={{ margin: "4px 0 10px", fontSize: 14, opacity: 0.75 }}>Share an honest positive or negative experience. Your rating will appear on the seller’s profile.</p>
      <StarRating value={rating} onChange={setRating} disabled={submitting} />
      <label htmlFor={`review-comment-${ticket.orderId}`} style={{ display: "block", marginTop: 10, fontWeight: 700, fontSize: 14 }}>
        Comments
      </label>
      <textarea
        id={`review-comment-${ticket.orderId}`}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={5000}
        rows={4}
        disabled={submitting}
        placeholder="How was communication, ticket accuracy, and delivery?"
        style={{ width: "100%", boxSizing: "border-box", marginTop: 5, padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.22)", resize: "vertical" }}
      />
      {error && <div role="alert" style={{ marginTop: 8, color: "rgba(153, 27, 27, 1)", fontWeight: 650 }}>{error}</div>}
      <button
        type="submit"
        disabled={submitting}
        style={{ marginTop: 10, padding: "10px 16px", borderRadius: 8, border: 0, background: "rgba(6, 74, 147, 1)", color: "white", fontWeight: 800, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.65 : 1 }}
      >
        {submitting ? "Submitting…" : "Submit seller review"}
      </button>
    </form>
  );
}

function TicketCard({ ticket, showReview, onReviewSubmitted }: { ticket: Ticket; showReview: boolean; onReviewSubmitted: (review: Review) => void }) {
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
        {ticket.image && (
          <img
            src={ticket.image}
            alt={ticket.title}
            style={{
              width: 120,
              height: 80,
              objectFit: "cover",
              borderRadius: 8,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{ticket.title}</h3>
          <p style={{ margin: "4px 0", opacity: 0.7 }}>{ticket.venue}</p>
          <p style={{ margin: "4px 0", opacity: 0.6, fontSize: 14 }}>{ticket.date}</p>
          <p style={{ margin: "8px 0 0", fontWeight: 700, color: "rgba(6, 74, 147, 1)" }}>
            ${ticket.price.toFixed(2)}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              background:
                ticket.status === "SOLD"
                  ? "rgba(34, 197, 94, 0.15)"
                  : "rgba(245, 158, 11, 0.15)",
              color: ticket.status === "SOLD" ? "rgba(21, 128, 61, 1)" : "rgba(180, 83, 9, 1)",
              textAlign: "center",
            }}
          >
            {ticket.status}
          </span>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
            Purchased {new Date(ticket.orderDate).toLocaleDateString()}
          </p>
        </div>
      </div>

      {showReview && <SellerReview ticket={ticket} onSubmitted={onReviewSubmitted} />}
    </div>
  );
}

function Body() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTickets() {
      try {
        const res = await fetch("/api/account/tickets/bought", { cache: "no-store" });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || "Failed to load tickets");
        }

        setTickets(data.tickets || []);
      } catch (err: any) {
        setError(err.message || "Failed to load tickets");
      } finally {
        setLoading(false);
      }
    }

    fetchTickets();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ opacity: 0.7 }}>Loading your tickets...</div>
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

  if (tickets.length === 0) {
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
        <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>No tickets yet</h3>
        <p style={{ margin: 0, opacity: 0.7 }}>
          Completed purchases will appear here. Pending transfers are shown in Holding. Browse available tickets on the{" "}
          <Link href="/" style={{ textDecoration: "underline", color: "rgba(6, 74, 147, 1)" }}>
            homepage
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        You have {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
      </p>
      {tickets.map((ticket) => (
        <TicketCard
          key={ticket.id}
          ticket={ticket}
          showReview={tickets.find((candidate) => candidate.orderId === ticket.orderId)?.id === ticket.id}
          onReviewSubmitted={(review) =>
            setTickets((current) => current.map((item) => item.orderId === ticket.orderId ? { ...item, review } : item))
          }
        />
      ))}
    </div>
  );
}

export default function BoughtTicketsPage() {
  return (
    <Shell title="Tickets — Bought">
      <AccountGate
        nextPath="/account/tickets/bought"
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
