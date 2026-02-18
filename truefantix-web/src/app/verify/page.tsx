"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type MeUser = {
  email: string;
  phone: string;
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

export default function VerifyPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextFromQuery = useMemo(() => {
    const n = sp.get("next");
    return isSafeNext(n) ? n : null;
  }, [sp]);

  const desiredNext = useMemo(() => nextFromQuery ?? "/", [nextFromQuery]);

  const loginReturnTo = useMemo(() => {
    // /login?next=<encoded "/verify?next=<encoded desiredNext>">
    const verifyPath = `/verify?next=${encodeURIComponent(desiredNext)}`;
    return `/login?next=${encodeURIComponent(verifyPath)}`;
  }, [desiredNext]);

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If we are redirecting away, avoid rendering the verify UI
  const [redirecting, setRedirecting] = useState(false);

  // Focus styling for code inputs
  const [focusEmailCode, setFocusEmailCode] = useState(false);
  const [focusPhoneCode, setFocusPhoneCode] = useState(false);

  const panelStyle: React.CSSProperties = {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,1)",
  };

  const alertErrorStyle: React.CSSProperties = {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    border: "1px solid rgba(255,0,0,0.35)",
    borderRadius: 10,
    background: "rgba(254, 242, 242, 1)",
    color: "rgba(153, 27, 27, 1)",
  };

  const alertOkStyle: React.CSSProperties = {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    border: "1px solid rgba(34, 197, 94, 0.35)",
    borderRadius: 10,
    background: "rgba(240, 253, 244, 1)",
    color: "rgba(22, 101, 52, 1)",
  };

  const actionButtonStyle: React.CSSProperties = {
    padding: 10,
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "rgba(37, 99, 235, 1)",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "rgba(15, 23, 42, 0.04)",
    cursor: "pointer",
    fontWeight: 800,
    color: "rgba(15, 23, 42, 1)",
  };

  const disabledButton: React.CSSProperties = {
    opacity: 0.6,
    cursor: "not-allowed",
  };

  const codeInputStyle = (focused: boolean): React.CSSProperties => ({
    flex: "1 1 180px",
    padding: 10,
    borderRadius: 10,
    border: focused ? "1px solid rgba(37, 99, 235, 0.65)" : "1px solid rgba(148, 163, 184, 0.9)",
    background: "rgba(248, 250, 252, 1)", // light slate so it's obvious
    outline: "none",
    boxShadow: focused ? "0 0 0 3px rgba(37, 99, 235, 0.18)" : "none",
    color: "rgba(15, 23, 42, 1)",
  });

  async function loadMe() {
    setLoading(true);
    setErr(null);

    try {
      const { res, data } = await fetchJson("/api/auth/me", { cache: "no-store" });

      // Bank-grade introspection: logged out => 200 + { ok:true, user:null }
      if (res.ok && data && (data as any).ok === true && (data as any).user == null) {
        setRedirecting(true);
        router.replace(loginReturnTo);
        return;
      }

      // Back-compat: if older behavior ever returns 401
      if (res.status === 401) {
        setRedirecting(true);
        router.replace(loginReturnTo);
        return;
      }

      if (!res.ok || !data) {
        setMe({ ok: false, error: "FAILED", message: "Failed to load account status." });
        return;
      }

      setMe(data as MeResponse);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginReturnTo]);

  const authedUser: MeUser | null = useMemo(() => {
    if (!me) return null;
    if ((me as any).ok !== true) return null;
    return (me as any).user ?? null;
  }, [me]);

  const isAuthed = !!authedUser;

  const emailVerified = useMemo(() => {
    if (!authedUser) return false;
    return !!authedUser.emailVerifiedAt;
  }, [authedUser]);

  const phoneVerified = useMemo(() => {
    if (!authedUser) return false;
    return !!authedUser.phoneVerifiedAt;
  }, [authedUser]);

  const isVerified = useMemo(() => {
    if (!authedUser) return false;
    if (authedUser.flags && authedUser.flags.isVerified === true) return true;
    return emailVerified && phoneVerified;
  }, [authedUser, emailVerified, phoneVerified]);

  // Guard: if logged in + verified, redirect to desiredNext
  useEffect(() => {
    if (!loading && isAuthed && isVerified) {
      setRedirecting(true);
      router.replace(desiredNext);
      router.refresh();
    }
  }, [loading, isAuthed, isVerified, router, desiredNext]);

  async function sendEmail() {
    setMsg(null);
    setErr(null);
    setBusy(true);
    try {
      const { res, data } = await fetchJson("/api/verify/email/send", { method: "POST" });
      if (!res.ok) {
        setErr((data && (data as any).message) || "Could not send email code.");
        return;
      }
      setMsg("Email code generated. (Dev: check your server console for the code.)");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmail() {
    const code = emailCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setErr("Enter the 6-digit email code.");
      return;
    }
    setMsg(null);
    setErr(null);
    setBusy(true);
    try {
      const { res, data } = await fetchJson("/api/verify/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setErr((data && (data as any).message) || "Email verification failed.");
        return;
      }
      setMsg("Email verified ✅");
      setEmailCode("");
      await loadMe();
    } finally {
      setBusy(false);
    }
  }

  async function sendPhone() {
    setMsg(null);
    setErr(null);
    setBusy(true);
    try {
      const { res, data } = await fetchJson("/api/verify/phone/send", { method: "POST" });
      if (!res.ok) {
        setErr((data && (data as any).message) || "Could not send phone code.");
        return;
      }
      setMsg("Phone code generated. (Dev: check your server console for the code.)");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPhone() {
    const code = phoneCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setErr("Enter the 6-digit phone code.");
      return;
    }
    setMsg(null);
    setErr(null);
    setBusy(true);
    try {
      const { res, data } = await fetchJson("/api/verify/phone/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setErr((data && (data as any).message) || "Phone verification failed.");
        return;
      }
      setMsg("Phone verified ✅");
      setPhoneCode("");
      await loadMe();
    } finally {
      setBusy(false);
    }
  }

  // While loading or redirecting, keep it simple and avoid flashing the form.
  if (loading || redirecting) {
    return (
      <div style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Verify your account</h1>
        <p style={{ opacity: 0.8 }}>{redirecting ? "Redirecting…" : "Loading…"}</p>
      </div>
    );
  }

  // Safe fallback
  if (!isAuthed || !authedUser) {
    return (
      <div style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Verify your account</h1>
        <p style={{ opacity: 0.85 }}>You must be logged in to verify.</p>
        <a href={loginReturnTo} style={{ textDecoration: "underline" }}>
          Go to login
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Verify your account</h1>

      <p style={{ marginTop: 0, opacity: 0.85 }}>
        Email and phone verification are required before using verified-only features.
      </p>

      {err ? (
        <div role="alert" style={alertErrorStyle}>
          {err}
        </div>
      ) : null}

      {msg ? <div style={alertOkStyle}>{msg}</div> : null}

      {/* EMAIL */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Email</div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>{authedUser.email}</div>
          </div>
          <div style={{ fontWeight: 800 }}>{emailVerified ? "Verified ✅" : "Not verified"}</div>
        </div>

        {!emailVerified ? (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <button
              onClick={sendEmail}
              disabled={busy}
              style={{ ...actionButtonStyle, ...(busy ? disabledButton : null) }}
            >
              Send email code
            </button>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={busy}
                style={codeInputStyle(focusEmailCode)}
                onFocus={() => setFocusEmailCode(true)}
                onBlur={() => setFocusEmailCode(false)}
              />
              <button
                onClick={confirmEmail}
                disabled={busy}
                style={{ ...secondaryButtonStyle, ...(busy ? disabledButton : null) }}
              >
                Confirm
              </button>
            </div>

            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Dev mode: the code prints in your terminal (later we’ll email it for real).
            </div>
          </div>
        ) : null}
      </div>

      {/* PHONE */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Phone</div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>{authedUser.phone}</div>
          </div>
          <div style={{ fontWeight: 800 }}>{phoneVerified ? "Verified ✅" : "Not verified"}</div>
        </div>

        {!phoneVerified ? (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <button
              onClick={sendPhone}
              disabled={busy}
              style={{ ...actionButtonStyle, ...(busy ? disabledButton : null) }}
            >
              Send text code
            </button>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={busy}
                style={codeInputStyle(focusPhoneCode)}
                onFocus={() => setFocusPhoneCode(true)}
                onBlur={() => setFocusPhoneCode(false)}
              />
              <button
                onClick={confirmPhone}
                disabled={busy}
                style={{ ...secondaryButtonStyle, ...(busy ? disabledButton : null) }}
              >
                Confirm
              </button>
            </div>

            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Dev mode: the code prints in your terminal (later we’ll SMS it for real).
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 18, fontSize: 13, opacity: 0.8 }}>
        When both are verified, you’ll be redirected automatically.
      </div>
    </div>
  );
}
