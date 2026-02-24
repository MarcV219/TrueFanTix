"use client";

import React, { useState } from "react";

export default function ComingSoonPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "landing_page" }),
      });

      if (res.ok) {
        setSubmitted(true);
        setEmail("");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 600 }}>
        <h1
          style={{
            fontSize: "clamp(2.5rem, 6vw, 4rem)",
            fontWeight: 800,
            marginBottom: 16,
            background: "linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Welcome to TrueFanTix
        </h1>

        <p
          style={{
            fontSize: "clamp(1.125rem, 2.5vw, 1.5rem)",
            opacity: 0.9,
            marginBottom: 8,
          }}
        >
          Tickets to live events at or below face value.
        </p>

        <p
          style={{
            fontSize: "1.25rem",
            fontWeight: 600,
            opacity: 0.7,
            marginBottom: 48,
          }}
        >
          Coming Soon...
        </p>

        {!submitted ? (
          <div
            style={{
              background: "rgba(255,255,255,0.05)",
              borderRadius: 16,
              padding: "32px 24px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Join the Early Access List
            </h2>
            <p style={{ opacity: 0.7, marginBottom: 24 }}>
              Be the first to know when we launch. No spam, just tickets.
            </p>

            <form
              onSubmit={handleSubmit}
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                style={{
                  flex: 1,
                  minWidth: 250,
                  padding: "14px 18px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: "1rem",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "14px 28px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
                  color: "white",
                  fontWeight: 700,
                  fontSize: "1rem",
                  cursor: "pointer",
                  transition: "opacity 0.2s",
                }}
              >
                Notify Me
              </button>
            </form>

            {error && (
              <p style={{ color: "#fca5a5", marginTop: 16, fontSize: "0.875rem" }}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <div
            style={{
              background: "rgba(34,197,94,0.1)",
              borderRadius: 16,
              padding: "32px 24px",
              border: "1px solid rgba(34,197,94,0.3)",
            }}
          >
            <p style={{ color: "#86efac", fontSize: "1.125rem", fontWeight: 600 }}>
              You're on the list! 🎉
            </p>
            <p style={{ opacity: 0.7, marginTop: 8 }}>
              We'll let you know when TrueFanTix goes live.
            </p>
          </div>
        )}

        <p style={{ opacity: 0.4, marginTop: 48, fontSize: "0.875rem" }}>
          © 2026 TrueFanTix. All rights reserved.
        </p>
      </div>
    </div>
  );
}
