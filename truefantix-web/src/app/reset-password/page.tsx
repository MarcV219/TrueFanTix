"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token || !email) {
      setError("Invalid reset link. Please request a new password reset.");
    }
  }, [token, email]);

  const passwordsMatch = password === confirmPassword;
  const passwordsEntered = password.length > 0 || confirmPassword.length > 0;
  const showMismatch = passwordsEntered && !passwordsMatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token || !email) {
      setError("Invalid reset link.");
      return;
    }

    if (!password) {
      setError("Please enter a new password.");
      return;
    }

    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }

    const hasLetter = /[A-Za-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasLetter || !hasNumber) {
      setError("Password must include at least one letter and one number.");
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const { res, data } = await fetchJson("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, password }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(data?.message || "Failed to reset password. Please try again.");
      return;
    }

    setSuccess(true);
    // Redirect to login after 2 seconds
    setTimeout(() => {
      router.push("/login");
    }, 2000);
  }

  if (success) {
    return (
      <div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}>
        <div
          role="status"
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(34, 197, 94, 0.35)",
            background: "rgba(240, 253, 244, 1)",
            color: "rgba(22, 101, 52, 1)",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Success!</div>
          <div>Your password has been reset.</div>
          <div style={{ marginTop: 8, opacity: 0.8 }}>Redirecting to login...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Create new password</h1>
      <p style={{ marginTop: 0, opacity: 0.8, marginBottom: 20 }}>
        Enter a new password for your account.
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

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
            style={inputStyle}
            disabled={isSubmitting || !token || !email}
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
            disabled={isSubmitting || !token || !email}
            autoComplete="new-password"
          />
          {showMismatch && (
            <span style={{ fontSize: 12, color: "rgba(200,0,0,0.9)" }}>Passwords do not match.</span>
          )}
        </label>

        <button
          type="submit"
          disabled={isSubmitting || !token || !email}
          style={{
            ...buttonPrimary,
            opacity: isSubmitting || !token || !email ? 0.6 : 1,
            cursor: isSubmitting || !token || !email ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting ? "Resetting..." : "Reset password"}
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

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}>
          <div style={{ textAlign: "center", opacity: 0.8 }}>Loading...</div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
