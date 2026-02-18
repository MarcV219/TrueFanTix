"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type RegisterResponse = { ok: true; next?: string } | { error?: string; message?: string };

type MeUser = {
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  flags?: { isVerified?: boolean };
};

type MeResponse =
  | { ok: true; user: MeUser | null }
  | { ok: false; error: string; message?: string };

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

function isSafeNext(n: string | null) {
  return !!n && n.startsWith("/") && !n.startsWith("//");
}

function buildVerifyUrl(nextPath: string) {
  const safe = isSafeNext(nextPath) ? nextPath : "/";
  return `/verify?next=${encodeURIComponent(safe)}`;
}

function normalizePhoneLike(s: string) {
  // VERY light normalization for "do these match" checks in UI.
  // (Server should do real normalization/validation.)
  return (s ?? "").replace(/[^\d+]/g, "").trim();
}

function computeIsVerified(user: MeUser | null) {
  if (!user) return false;
  if (user.flags && user.flags.isVerified === true) return true;
  return !!user.emailVerifiedAt && !!user.phoneVerifiedAt;
}

export default function RegisterPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextFromQuery = useMemo(() => {
    const n = sp.get("next");
    return isSafeNext(n) ? n : null;
  }, [sp]);

  const desiredNext = useMemo(() => nextFromQuery ?? "/", [nextFromQuery]);

  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Required fields per your Register API
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [streetAddress1, setStreetAddress1] = useState("");
  const [streetAddress2, setStreetAddress2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Canada");

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);

  const passwordsEntered = password.length > 0 || confirmPassword.length > 0;
  const passwordsMatch = password === confirmPassword;
  const showPasswordMismatch = passwordsEntered && !passwordsMatch;

  const baseInputStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "rgba(245, 247, 250, 1)", // light gray so it’s obvious where to type
    color: "rgba(0,0,0,0.9)",
    outline: "none",
  };

  const helpTextStyle: React.CSSProperties = {
    fontSize: 12,
    opacity: 0.85,
    marginTop: 2,
  };

  async function routeBasedOnMe(fallbackNext: string) {
    const safeNext = isSafeNext(fallbackNext) ? fallbackNext : "/";

    const { res, data } = await fetchJson("/api/auth/me", {
      method: "GET",
      cache: "no-store",
    });

    // Bank-grade /me behavior:
    // - 200 { ok:true, user:null } => NOT logged in
    // - 200 { ok:true, user:{...} } => logged in
    if (!res.ok || !data) return false;

    const me = data as MeResponse;

    // Not logged in -> stay on register
    if ("ok" in me && me.ok === true && me.user === null) return false;

    // Any other non-ok payload => treat as not logged in / don’t redirect
    if (!("ok" in me) || me.ok !== true) return false;

    const isVerified = computeIsVerified(me.user);
    const target = isVerified ? safeNext : buildVerifyUrl(safeNext);

    router.replace(target);
    router.refresh();
    return true;
  }

  // If already logged in, redirect away from /register
  useEffect(() => {
    let alive = true;

    async function check() {
      try {
        await routeBasedOnMe(desiredNext);
      } finally {
        if (alive) setChecking(false);
      }
    }

    check();
    return () => {
      alive = false;
    };
  }, [desiredNext, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Minimal client-side checks (server enforces real rules)
    if (!email.trim()) return setError("Email is required.");
    if (!phone.trim()) return setError("Phone number is required.");
    if (!password) return setError("Password is required.");
    if (!confirmPassword) return setError("Please confirm your password.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    if (!firstName.trim()) return setError("First name is required.");
    if (!lastName.trim()) return setError("Last name is required.");
    if (!streetAddress1.trim()) return setError("Street address is required.");
    if (!city.trim()) return setError("City is required.");
    if (!region.trim()) return setError("Province/State is required.");
    if (!postalCode.trim()) return setError("Postal/ZIP code is required.");
    if (!country.trim()) return setError("Country is required.");
    if (!acceptTerms) return setError("You must accept the Terms of Service to continue.");
    if (!acceptPrivacy) return setError("You must accept the Privacy Policy to continue.");

    setBusy(true);
    try {
      const { res, data } = await fetchJson("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          phone,
          password,
          firstName,
          lastName,
          displayName: displayName.trim() ? displayName : null,
          streetAddress1,
          streetAddress2: streetAddress2.trim() ? streetAddress2 : null,
          city,
          region,
          postalCode,
          country,
          acceptTerms,
          acceptPrivacy,
        }),
      });

      if (!res.ok) {
        const msg =
          (data && typeof data === "object" && "message" in data && (data as any).message) ||
          "Registration failed.";
        setError(String(msg));
        return;
      }

      // Prefer server-provided next if safe; otherwise use query next; otherwise "/"
      const parsed = (data ?? null) as RegisterResponse | null;
      const serverNext = parsed && "ok" in parsed && parsed.ok ? parsed.next ?? null : null;

      const fallbackNext = isSafeNext(serverNext) ? (serverNext as string) : desiredNext;

      // IMPORTANT: re-check /me to decide verify vs home/next
      const redirected = await routeBasedOnMe(fallbackNext);

      // If something odd happened, fall back to verify (safer default post-register)
      if (!redirected) {
        router.replace(buildVerifyUrl(fallbackNext));
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Create an account</h1>
        <p style={{ opacity: 0.8 }}>Loading…</p>
      </div>
    );
  }

  const canSubmit =
    !busy &&
    !!email.trim() &&
    !!phone.trim() &&
    !!password &&
    !!confirmPassword &&
    password === confirmPassword &&
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!streetAddress1.trim() &&
    !!city.trim() &&
    !!region.trim() &&
    !!postalCode.trim() &&
    !!country.trim() &&
    acceptTerms &&
    acceptPrivacy;

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Create an account</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        After registering, you’ll verify your email and phone.
      </p>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 12,
            border: "1px solid rgba(255,0,0,0.35)",
            borderRadius: 10,
            background: "rgba(255,0,0,0.06)",
            color: "rgba(0,0,0,0.9)",
          }}
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
            disabled={busy}
            placeholder="e.g. +1 705 555 0123"
            style={baseInputStyle}
          />
          <div style={helpTextStyle}>
            Tip: enter your number in international format if possible (e.g., +1…).
          </div>
          {phone.trim() && normalizePhoneLike(phone).length < 7 ? (
            <div style={{ ...helpTextStyle, color: "rgba(200,0,0,0.9)" }}>
              That phone number looks too short.
            </div>
          ) : null}
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Confirm password</span>
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            disabled={busy}
            style={{
              ...baseInputStyle,
              border: showPasswordMismatch
                ? "1px solid rgba(255,0,0,0.55)"
                : baseInputStyle.border,
              background: showPasswordMismatch ? "rgba(255,0,0,0.04)" : baseInputStyle.background,
            }}
          />
          {showPasswordMismatch ? (
            <div style={{ ...helpTextStyle, color: "rgba(200,0,0,0.9)" }}>
              Passwords do not match.
            </div>
          ) : null}
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>First name</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Last name</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Display name (optional)</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Street address</span>
          <input
            value={streetAddress1}
            onChange={(e) => setStreetAddress1(e.target.value)}
            autoComplete="address-line1"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Street address 2 (optional)</span>
          <input
            value={streetAddress2}
            onChange={(e) => setStreetAddress2(e.target.value)}
            autoComplete="address-line2"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>City</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Province / State</span>
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            autoComplete="address-level1"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Postal / ZIP</span>
          <input
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            autoComplete="postal-code"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Country</span>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            autoComplete="country-name"
            disabled={busy}
            style={baseInputStyle}
          />
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            disabled={busy}
          />
          <span>
            I accept the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
              Terms of Service
            </a>
          </span>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={acceptPrivacy}
            onChange={(e) => setAcceptPrivacy(e.target.checked)}
            disabled={busy}
          />
          <span>
            I accept the{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
              Privacy Policy
            </a>
          </span>
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.18)",
            background: !canSubmit ? "rgba(0,0,0,0.06)" : "rgba(37, 99, 235, 0.95)",
            color: !canSubmit ? "rgba(0,0,0,0.45)" : "white",
            cursor: !canSubmit ? "not-allowed" : "pointer",
            fontWeight: 800,
          }}
        >
          {busy ? "Creating account..." : "Create account"}
        </button>
      </form>

      <div style={{ marginTop: 12, fontSize: 13 }}>
        Already have an account?{" "}
        <a href="/login" style={{ textDecoration: "underline" }}>
          Log in
        </a>
      </div>
    </div>
  );
}
