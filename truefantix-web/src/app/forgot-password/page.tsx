"use client";

import React, { useState } from "react";
import Link from "next/link";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.9)",
  background: "rgba(248, 250, 252, 1)",
  color: "rgba(15, 23, 42, 1)",
  outline: "none",
  fontSize: 14,
};

const buttonPrimary: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 10,
  border: "1px solid rgba(37, 99, 235, 0.35)",
  background: "rgba(37, 99, 235, 1)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setDevUrl(null);

    const emailTrimmed = email.trim();
    if (!emailTrimmed) {
      setError("Please enter your email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    const { res, data } = await fetchJson("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailTrimmed }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(data?.message || "Failed to send reset email. Please try again.");
      return;
    }

    setSuccess("If an account exists with this email, you will receive password reset instructions.");
    if (data?.dev && data?.resetUrl) {
      setDevUrl(data.resetUrl);
    }
    setEmail("");
  }

  return (
    <div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Reset your password</h1>
      <p style={{ marginTop: 0, opacity: 0.8, marginBottom: 20 }}>
        Enter your email address and we&apos;ll send you a link to reset your password.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(255,0,0,0.35)",
            background: "rgba(254, 242, 242, 1)",
            color: "rgba(153, 27, 27, 1)",
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(34, 197, 94, 0.35)",
            background: "rgba(240, 253, 244, 1)",
            color: "rgba(22, 101, 52, 1)",
          }}
        >
          {success}
          {devUrl && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>DEV MODE - Reset URL:</div>
              <a
                href={devUrl}
                style={{
                  color: "rgba(22, 101, 52, 1)",
                  wordBreak: "break-all",
                  textDecoration: "underline",
                }}
              >
                {devUrl}
              </a>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Email address</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle}
            disabled={isSubmitting}
            autoComplete="email"
          />
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            ...buttonPrimary,
            opacity: isSubmitting ? 0.6 : 1,
            cursor: isSubmitting ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <div style={{ marginTop: 20, textAlign: "center" }}>
        <Link href="/login" style={{ textDecoration: "underline", opacity: 0.8 }}>
          Back to login
        </Link>
      </div>
    </div>
  );
}
