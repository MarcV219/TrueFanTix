"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type LoginResponse = { ok: true; next?: string } | { error?: string; message?: string };

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

function computeIsVerified(user: MeUser | null) {
  if (!user) return false;
  if (user.flags && user.flags.isVerified === true) return true;
  return !!user.emailVerifiedAt && !!user.phoneVerifiedAt;
}

// Centralized input style so it’s obvious where to type
const INPUT_BASE: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  background: "rgba(248, 250, 252, 1)", // light slate fill (visible on white)
  color: "rgba(15, 23, 42, 1)",
  outline: "none",
};

function inputStyle(focused: boolean, disabled: boolean): React.CSSProperties {
  return {
    ...INPUT_BASE,
    border: focused ? "1px solid rgba(37, 99, 235, 0.75)" : "1px solid rgba(148, 163, 184, 0.9)",
    boxShadow: focused ? "0 0 0 3px rgba(37, 99, 235, 0.18)" : "none",
    opacity: disabled ? 0.7 : 1,
    cursor: disabled ? "not-allowed" : "text",
  };
}

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextFromQuery = useMemo(() => {
    const n = sp.get("next");
    return isSafeNext(n) ? n : null;
  }, [sp]);

  const desiredNext = useMemo(() => nextFromQuery ?? "/", [nextFromQuery]);

  const [checking, setChecking] = useState(true);

  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus styling
  const [focusEp, setFocusEp] = useState(false);
  const [focusPw, setFocusPw] = useState(false);

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

    // Not logged in (normal)
    if ("ok" in me && me.ok === true && me.user === null) return false;

    // Any other non-ok payload => treat as not logged in / don’t redirect
    if (!("ok" in me) || me.ok !== true) return false;

    // Logged in
    const isVerified = computeIsVerified(me.user);
    const target = isVerified ? safeNext : buildVerifyUrl(safeNext);

    router.replace(target);
    router.refresh();
    return true;
  }

  // If already logged in, redirect away from /login
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

    const ep = emailOrPhone.trim();
    if (!ep) return setError("Please enter your email or phone number.");
    if (!password) return setError("Please enter your password.");

    setBusy(true);
    try {
      const { res, data } = await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrPhone: ep, password }),
      });

      if (!res.ok) {
        const msg =
          (data && typeof data === "object" && "message" in data && (data as any).message) ||
          "Login failed. Please check your credentials and try again.";
        setError(String(msg));
        return;
      }

      // Prefer server-provided next if it is safe; otherwise use query next; otherwise "/"
      const parsed = (data ?? null) as LoginResponse | null;
      const serverNext = parsed && "ok" in parsed && parsed.ok ? parsed.next ?? null : null;

      const fallbackNext = isSafeNext(serverNext) ? (serverNext as string) : desiredNext;

      // IMPORTANT: re-check /me to decide verify vs home/next
      const redirected = await routeBasedOnMe(fallbackNext);

      // If something odd happened and /me didn't redirect, fall back
      if (!redirected) {
        router.replace(isSafeNext(fallbackNext) ? fallbackNext : "/");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // While checking session, avoid flashing the form
  if (checking) {
    return (
      <div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Log in</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Log in</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>Use your email or phone number.</p>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 12,
            border: "1px solid rgba(255,0,0,0.35)",
            borderRadius: 10,
            background: "rgba(254, 242, 242, 1)",
            color: "rgba(153, 27, 27, 1)",
          }}
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Email or phone</span>
          <input
            value={emailOrPhone}
            onChange={(e) => setEmailOrPhone(e.target.value)}
            autoComplete="username"
            inputMode="text"
            placeholder="email@example.com or 4165551234"
            style={inputStyle(focusEp, busy)}
            onFocus={() => setFocusEp(true)}
            onBlur={() => setFocusEp(false)}
            disabled={busy}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Password</span>
            <a
              href="/forgot-password"
              style={{ fontSize: 12, textDecoration: "underline", opacity: 0.8 }}
            >
              Forgot password?
            </a>
          </div>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            style={inputStyle(focusPw, busy)}
            onFocus={() => setFocusPw(true)}
            onBlur={() => setFocusPw(false)}
            disabled={busy}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(37, 99, 235, 0.35)",
            background: busy ? "rgba(37, 99, 235, 0.55)" : "rgba(37, 99, 235, 1)",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 800,
            color: "white",
          }}
        >
          {busy ? "Logging in..." : "Log in"}
        </button>
      </form>

      <div style={{ marginTop: 14, opacity: 0.75, fontSize: 13 }}>
        If your account isn’t verified yet, you’ll be sent to verification after login.
      </div>

      <div style={{ marginTop: 12, fontSize: 13 }}>
        New here?{" "}
        <a href="/register" style={{ textDecoration: "underline" }}>
          Create an account
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 440, margin: "40px auto", padding: 16 }}><h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Log in</h1><p style={{ marginTop: 0, opacity: 0.8 }}>Loading…</p></div>}>
      <LoginForm />
    </Suspense>
  );
}
