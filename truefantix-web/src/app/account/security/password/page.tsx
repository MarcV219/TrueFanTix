"use client";

import React, { useState } from "react";
import Link from "next/link";
import AccountGate from "@/app/account/_components/accountgate";

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

function Body() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const passwordsMatch = newPassword === confirmPassword;
  const passwordsEntered = newPassword.length > 0 || confirmPassword.length > 0;
  const showMismatch = passwordsEntered && !passwordsMatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPassword) {
      setError("Please enter your current password.");
      return;
    }

    if (!newPassword) {
      setError("Please enter a new password.");
      return;
    }

    if (newPassword.length < 10) {
      setError("New password must be at least 10 characters.");
      return;
    }

    const hasLetter = /[A-Za-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      setError("New password must include at least one letter and one number.");
      return;
    }

    if (!passwordsMatch) {
      setError("New passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const { res, data } = await fetchJson("/api/account/security/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(data?.message || "Failed to change password. Please try again.");
      return;
    }

    setSuccess("Password changed successfully!");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        maxWidth: 520,
      }}
    >
      <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 16 }}>Change Password</div>

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
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Current password</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••••"
            style={inputStyle}
            disabled={isSubmitting}
            autoComplete="current-password"
          />
        </label>

        <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />

        <label style={{ display: "grid", gap: 6 }}>
          <span>New password</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••••"
            style={inputStyle}
            disabled={isSubmitting}
            autoComplete="new-password"
          />
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            At least 10 characters with one letter and one number.
          </span>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Confirm new password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••••"
            style={{
              ...inputStyle,
              border: showMismatch
                ? "1px solid rgba(255,0,0,0.55)"
                : "1px solid rgba(148, 163, 184, 0.9)",
              background: showMismatch ? "rgba(255,0,0,0.04)" : "rgba(248, 250, 252, 1)",
            }}
            disabled={isSubmitting}
            autoComplete="new-password"
          />
          {showMismatch && (
            <span style={{ fontSize: 12, color: "rgba(200,0,0,0.9)" }}>Passwords do not match.</span>
          )}
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            ...buttonPrimary,
            opacity: isSubmitting ? 0.6 : 1,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            marginTop: 8,
          }}
        >
          {isSubmitting ? "Changing..." : "Change Password"}
        </button>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Shell title="Change password">
      <AccountGate
        nextPath="/account/security/password"
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
