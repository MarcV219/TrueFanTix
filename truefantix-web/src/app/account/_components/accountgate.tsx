"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

export type MeUser = {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  sellerId: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  country: string;
  region: string;
  city: string;
  postalCode: string;
  streetAddress1: string;
  streetAddress2: string | null;
  canBuy: boolean;
  canComment: boolean;
  canSell: boolean;
  role: "USER" | "ADMIN";
  sellerStatus: string | null;
  isBanned: boolean;
  flags: {
    isVerified: boolean;
    isSellerApproved: boolean;
    isAdmin: boolean;
  };
};

type MeResponse =
  | { ok: true; user: MeUser }
  | { ok: false; error: string; message?: string };

async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return data as MeResponse;
}

interface AccountGateProps {
  children: (user: MeUser) => React.ReactNode;
  nextPath?: string;
  loadingFallback?: React.ReactNode;
  errorFallback?: (message: string) => React.ReactNode;
  requireVerified?: boolean;
}

export default function AccountGate({
  children,
  nextPath = "/account",
  loadingFallback = <p>Loading…</p>,
  errorFallback = (message: string) => (
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
  ),
  requireVerified = false,
}: AccountGateProps) {
  const [state, setState] = useState<{
    loading: boolean;
    user: MeUser | null;
    error: string | null;
  }>({
    loading: true,
    user: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const data = await fetchMe();

        if (!alive) return;

        if (data.ok === false) {
          setState({ loading: false, user: null, error: data.message || data.error || "Failed to load account." });
          return;
        }

        if (!data.user) {
          setState({ loading: false, user: null, error: "Not authenticated." });
          return;
        }

        // Check if verification is required
        if (requireVerified) {
          const isVerified = !!data.user.emailVerifiedAt && !!data.user.phoneVerifiedAt;
          if (!isVerified) {
            // Redirect to verification
            window.location.href = `/verify?next=${encodeURIComponent(nextPath)}`;
            return;
          }
        }

        setState({ loading: false, user: data.user, error: null });
      } catch (err: any) {
        if (!alive) return;
        setState({ loading: false, user: null, error: err?.message || "Failed to load account." });
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [nextPath, requireVerified]);

  if (state.loading) {
    return <>{loadingFallback}</>;
  }

  if (state.error || !state.user) {
    const message = state.error || "Please log in to continue.";
    return (
      <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
        {errorFallback(message)}
        <div style={{ marginTop: 16 }}>
          <Link
            href={`/login?next=${encodeURIComponent(nextPath)}`}
            style={{
              padding: "12px 24px",
              borderRadius: 10,
              background: "rgba(37, 99, 235, 1)",
              color: "white",
              textDecoration: "none",
              fontWeight: 800,
              display: "inline-block",
            }}
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  return <>{children(state.user)}</>;
}
