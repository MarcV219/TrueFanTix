"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AccountGate, { MeUser } from "@/app/account/_components/accountgate";
import { apiFetch, fetchJson } from "@/lib/api-fetch";

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{title}</h2>
          {description ? <div style={{ marginTop: 6, opacity: 0.78 }}>{description}</div> : null}
        </div>
      </div>
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

function ToolLink({
  label,
  hint,
  href,
  disabled,
  count,
  attention,
  attentionLabel,
}: {
  label: string;
  hint?: string;
  href: string;
  disabled?: boolean;
  count?: number;
  attention?: "active" | "required";
  attentionLabel?: string;
}) {
  const requiresAction = attention === "required";
  const isActive = attention === "active";
  const styles: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    border: disabled
      ? "1px solid rgba(0,0,0,0.10)"
      : requiresAction
      ? "1px solid rgba(217, 119, 6, 0.55)"
      : isActive
      ? "1px solid rgba(37, 99, 235, 0.35)"
      : "1px solid rgba(0,0,0,0.10)",
    background: disabled
      ? "rgba(148, 163, 184, 0.12)"
      : requiresAction
      ? "rgba(255, 251, 235, 1)"
      : isActive
      ? "rgba(239, 246, 255, 1)"
      : "rgba(248, 250, 252, 1)",
    color: "rgba(15, 23, 42, 1)",
    textDecoration: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    boxShadow: disabled
      ? "none"
      : requiresAction
      ? "0 0 0 3px rgba(245, 158, 11, 0.14)"
      : isActive
      ? "0 0 0 3px rgba(37, 99, 235, 0.08)"
      : "none",
  };

  const right = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {typeof count === "number" && count > 0 ? (
        <span
          aria-label={`${count} item${count === 1 ? "" : "s"}`}
          style={{
            minWidth: 28,
            height: 24,
            padding: "0 8px",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: requiresAction ? "rgba(217, 119, 6, 1)" : "rgba(6, 74, 147, 1)",
            color: "white",
            fontSize: 12,
            fontWeight: 950,
          }}
        >
          {count}
        </span>
      ) : null}
      <span style={{ fontWeight: 900, opacity: 0.7 }} aria-hidden>
        →
      </span>
    </div>
  );

  const badge = attentionLabel ? (
    <span
      style={{
        width: "fit-content",
        marginTop: 4,
        padding: "4px 8px",
        borderRadius: 999,
        background: requiresAction ? "rgba(245, 158, 11, 0.18)" : "rgba(37, 99, 235, 0.12)",
        color: requiresAction ? "rgba(146, 64, 14, 1)" : "rgba(30, 64, 175, 1)",
        fontSize: 11,
        fontWeight: 950,
        textTransform: "uppercase",
        letterSpacing: 0,
      }}
    >
      {attentionLabel}
    </span>
  ) : null;

  if (disabled) {
    return (
      <div style={styles}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 900 }}>{label}</div>
          {hint ? <div style={{ fontSize: 12, opacity: 0.75 }}>{hint}</div> : null}
          {badge}
        </div>
        {right}
      </div>
    );
  }

  return (
    <Link href={href} style={styles}>
      <div style={{ display: "grid", gap: 2 }}>
        <div style={{ fontWeight: 900 }}>{label}</div>
        {hint ? <div style={{ fontSize: 12, opacity: 0.75 }}>{hint}</div> : null}
        {badge}
      </div>
      {right}
    </Link>
  );
}

type TicketOverview = {
  pendingCheckout: { count: number; orderId: string | null };
  holding: { count: number; actionRequired: number };
  selling: { count: number };
  sellerHolding: { count: number; actionRequired: number };
  bought: { count: number; activeUpcoming: number };
  sold: { count: number };
};

const emptyTicketOverview: TicketOverview = {
  pendingCheckout: { count: 0, orderId: null },
  holding: { count: 0, actionRequired: 0 },
  selling: { count: 0 },
  sellerHolding: { count: 0, actionRequired: 0 },
  bought: { count: 0, activeUpcoming: 0 },
  sold: { count: 0 },
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: ok ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(148,163,184,0.55)",
        background: ok ? "rgba(240,253,244,1)" : "rgba(248,250,252,1)",
        color: ok ? "rgba(22,101,52,1)" : "rgba(15,23,42,0.8)",
        fontWeight: 900,
        fontSize: 12,
        lineHeight: 1,
      }}
    >
      <span aria-hidden>{ok ? "✓" : "•"}</span>
      {label}
    </span>
  );
}

function AccountHub({ me }: { me: MeUser }) {
  const displayName = me?.displayName?.trim() || `${me.firstName} ${me.lastName}`;

  const emailVerified = !!me?.emailVerifiedAt;
  const phoneVerified = !!me?.phoneVerifiedAt;

  const platformVerified =
    (me?.flags && me.flags.isVerified === true) || (emailVerified && phoneVerified);

  const [stripeOk, setStripeOk] = React.useState<boolean>(false);
  const [stripeHasAccount, setStripeHasAccount] = React.useState<boolean>(false);
  const [stripeChecked, setStripeChecked] = React.useState<boolean>(false);
  const [stripeBusy, setStripeBusy] = React.useState<boolean>(false);
  const [stripeManageBusy, setStripeManageBusy] = React.useState<boolean>(false);
  const [stripeError, setStripeError] = React.useState<string | null>(null);

  // Seller eligibility:
  const sellerEligible = emailVerified && phoneVerified && stripeOk;

  const [accessTokenBalance, setAccessTokenBalance] = React.useState<number>(0);
  const [ticketOverview, setTicketOverview] = React.useState<TicketOverview>(emptyTicketOverview);
  const [ticketOverviewError, setTicketOverviewError] = React.useState<string | null>(null);

  // Delete form state
  const [deletePassword, setDeletePassword] = React.useState("");
  const [deleteConfirm, setDeleteConfirm] = React.useState("");
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleteOk, setDeleteOk] = React.useState<string | null>(null);

  // Focus state (to make inputs feel obvious)
  const [focusPw, setFocusPw] = React.useState(false);
  const [focusDelete, setFocusDelete] = React.useState(false);

  const searchParams = useSearchParams();
  const stripeQuery = (searchParams?.get("stripe") || "").toLowerCase();

  // Centralized status loader (used by effect + refresh button + post-return polling)
  const loadStripeStatus = React.useCallback(async () => {
    setStripeError(null);
    try {
      const { res, data } = await fetchJson("/api/sellers/onboarding/status", {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        setStripeChecked(true);
        if (data?.error === "STRIPE_NOT_CONFIGURED") {
          setStripeError("Seller verification is temporarily unavailable while Stripe setup is completed.");
        }
        return { ok: false as const, chargesEnabled: false, payoutsEnabled: false };
      }

      const chargesEnabled = !!data?.stripe?.chargesEnabled;
      const payoutsEnabled = !!data?.stripe?.payoutsEnabled;

      setStripeHasAccount(!!data?.stripe?.hasAccount);
      setStripeOk(chargesEnabled && payoutsEnabled);
      setStripeChecked(true);

      return { ok: true as const, chargesEnabled, payoutsEnabled };
    } catch {
      setStripeChecked(true);
      return { ok: false as const, chargesEnabled: false, payoutsEnabled: false };
    }
  }, []);

  // Initial load + (important) auto-refresh after Stripe redirects back
  React.useEffect(() => {
    let cancelled = false;
    let interval: any = null;
    let timeout: any = null;

    async function run() {
      // Always do at least one check on mount
      const first = await loadStripeStatus();
      if (cancelled) return;

      // If we just returned from Stripe, poll a bit to allow Stripe to flip capabilities
      const shouldPoll = stripeQuery === "return" || stripeQuery === "refresh";
      if (!shouldPoll) return;

      // If already enabled, no need to poll
      if (first.ok && first.chargesEnabled && first.payoutsEnabled) return;

      interval = setInterval(async () => {
        const r = await loadStripeStatus();
        if (cancelled) return;
        if (r.ok && r.chargesEnabled && r.payoutsEnabled) {
          clearInterval(interval);
          interval = null;
        }
      }, 2000);

      // Stop polling after 45 seconds (avoid infinite loops)
      timeout = setTimeout(() => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }, 45_000);
    }

    run();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [loadStripeStatus, stripeQuery]);

  React.useEffect(() => {
    let alive = true;

    async function loadAccessTokenBalance() {
      try {
        const { res, data } = await fetchJson("/api/account/access-tokens", {
          method: "GET",
          cache: "no-store",
        });

        if (!alive) return;
        if (!res.ok) return;

        setAccessTokenBalance(Number(data?.accessTokenBalance ?? 0));
      } catch {
        // ignore; default is 0
      }
    }

    loadAccessTokenBalance();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    let alive = true;

    async function loadTicketOverview() {
      setTicketOverviewError(null);
      try {
        const { res, data } = await fetchJson("/api/account/tickets/overview", {
          method: "GET",
          cache: "no-store",
        });

        if (!alive) return;
        if (!res.ok || !data?.ok) {
          throw new Error(String(data?.message || data?.error || `Failed to load ticket overview (${res.status}).`));
        }

        setTicketOverview({
          ...emptyTicketOverview,
          ...(data?.tickets ?? {}),
        });
      } catch (e) {
        if (!alive) return;
        setTicketOverviewError(e instanceof Error ? e.message : "Ticket overview unavailable.");
      }
    }

    loadTicketOverview();
    return () => {
      alive = false;
    };
  }, []);

  async function startSellerOnboarding() {
    setStripeError(null);
    setStripeBusy(true);
    try {
      const { res, data } = await fetchJson("/api/sellers/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const msg = data?.error === "STRIPE_NOT_CONFIGURED"
          ? "Seller verification is temporarily unavailable while Stripe setup is completed."
          : (data && (data.message || data.error)) || `Unable to start onboarding (${res.status}).`;
        setStripeError(String(msg));
        return;
      }

      const url = data?.url;
      if (!url || typeof url !== "string") {
        setStripeError("Onboarding response missing URL.");
        return;
      }

      window.location.assign(url);
    } catch (e: any) {
      setStripeError(e?.message ?? "Unable to start onboarding.");
    } finally {
      setStripeBusy(false);
    }
  }

  async function openStripeDashboard() {
    setStripeError(null);
    setStripeManageBusy(true);
    try {
      const { res, data } = await fetchJson("/api/sellers/onboarding/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const msg = data?.error === "STRIPE_NOT_CONFIGURED"
          ? "Seller verification is temporarily unavailable while Stripe setup is completed."
          : (data && (data.message || data.error)) || `Unable to open Stripe dashboard (${res.status}).`;
        setStripeError(String(msg));
        return;
      }

      const url = data?.url;
      if (!url || typeof url !== "string") {
        setStripeError("Stripe dashboard response missing URL.");
        return;
      }

      window.location.assign(url);
    } catch (e: any) {
      setStripeError(e?.message ?? "Unable to open Stripe dashboard.");
    } finally {
      setStripeManageBusy(false);
    }
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDeleteError(null);
    setDeleteOk(null);

    if (!deletePassword) {
      setDeleteError("Please enter your password to confirm.");
      return;
    }

    if (deleteConfirm.trim().toUpperCase() !== "DELETE") {
      setDeleteError('Type "DELETE" to confirm.');
      return;
    }

    setDeleteBusy(true);
    try {
      const { res, data } = await fetchJson("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ password: deletePassword }),
      });

      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || `Delete failed (${res.status}).`;
        setDeleteError(String(msg));
        return;
      }

      setDeleteOk("Account deleted. Logging you out…");

      await apiFetch("/api/auth/logout", { method: "POST", cache: "no-store" }).catch(() => undefined);
      window.location.assign("/");
    } catch (e: any) {
      setDeleteError(e?.message ?? "Delete failed.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const inputStyle = (
    focused: boolean,
    variant: "default" | "danger" = "default"
  ): React.CSSProperties => {
    const isDanger = variant === "danger";
    return {
      padding: 12,
      borderRadius: 10,
      border: focused
        ? isDanger
          ? "1px solid rgba(220, 38, 38, 0.65)"
          : "1px solid rgba(37, 99, 235, 0.65)"
        : "1px solid rgba(148, 163, 184, 0.9)",
      background: "rgba(248, 250, 252, 1)",
      color: "rgba(15, 23, 42, 1)",
      outline: "none",
      boxShadow: focused
        ? isDanger
          ? "0 0 0 3px rgba(220, 38, 38, 0.16)"
          : "0 0 0 3px rgba(37, 99, 235, 0.18)"
        : "none",
    };
  };

  return (
    <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 6 }}>Account</h1>
          <div style={{ opacity: 0.85 }}>
            Signed in as <span style={{ fontWeight: 800 }}>{displayName}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/" style={{ textDecoration: "underline" }}>
            Home
          </Link>
          <Link href="/verify?manage=1" style={{ textDecoration: "underline" }}>
            Verify
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
        <Card title="Profile" description="Your identity and verification status.">
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Email</div>
              <div style={{ fontWeight: 800 }}>
                {me.email}{" "}
                <span style={{ fontWeight: 700, opacity: 0.75 }}>
                  {emailVerified ? "✓ verified" : "• not verified"}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Phone</div>
              <div style={{ fontWeight: 800 }}>
                {me.phone}{" "}
                <span style={{ fontWeight: 700, opacity: 0.75 }}>
                  {phoneVerified ? "✓ verified" : "• not verified"}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Overall verification</div>
              <div
                style={{
                  fontWeight: 900,
                  color: platformVerified ? "green" : "rgba(0,0,0,0.7)",
                }}
              >
                {platformVerified ? "Verified" : "Not verified yet"}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
              <ToolLink
                label="Edit profile"
                hint="Update name, phone, display name, and contact preferences."
                href="/account/profile"
              />
              <ToolLink
                label="Manage verification"
                hint="Verify email/phone and complete any remaining checks."
                href="/verify?manage=1"
              />
            </div>
          </div>
        </Card>

        <Card
          title="Seller verification"
          description="Required before you can list tickets. This protects buyers and unlocks payouts."
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <StatusPill ok={emailVerified} label="Email verified" />
              <StatusPill ok={phoneVerified} label="Phone verified" />
              <StatusPill
                ok={stripeOk}
                label={
                  stripeChecked
                    ? "Identity + payouts (Stripe)"
                    : "Identity + payouts (Stripe) • checking…"
                }
              />
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: sellerEligible
                  ? "1px solid rgba(34,197,94,0.35)"
                  : "1px solid rgba(148,163,184,0.45)",
                background: sellerEligible ? "rgba(240,253,244,1)" : "rgba(248,250,252,1)",
                color: sellerEligible ? "rgba(22,101,52,1)" : "rgba(15,23,42,0.85)",
                fontWeight: 850,
              }}
            >
              {sellerEligible
                ? "You’re approved to sell."
                : "Complete verification to unlock selling (identity + payouts is handled through Stripe)."}
            </div>

            {stripeError ? (
              <div
                role="alert"
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(255,0,0,0.35)",
                  background: "rgba(254, 242, 242, 1)",
                  color: "rgba(153, 27, 27, 1)",
                  fontWeight: 700,
                }}
              >
                {stripeError}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={startSellerOnboarding}
                disabled={stripeBusy || sellerEligible || !(emailVerified && phoneVerified)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background:
                    stripeBusy || sellerEligible || !(emailVerified && phoneVerified)
                      ? "rgba(148, 163, 184, 0.18)"
                      : "rgba(15, 23, 42, 0.92)",
                  color:
                    stripeBusy || sellerEligible || !(emailVerified && phoneVerified)
                      ? "rgba(15,23,42,0.55)"
                      : "white",
                  fontWeight: 950,
                  cursor:
                    stripeBusy || sellerEligible || !(emailVerified && phoneVerified)
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {sellerEligible
                  ? "Seller verified"
                  : stripeBusy
                  ? "Starting verification…"
                  : !(emailVerified && phoneVerified)
                  ? "Verify email + phone first"
                  : "Start seller verification"}
              </button>

              <button
                type="button"
                onClick={() => loadStripeStatus()}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "rgba(248, 250, 252, 1)",
                  color: "rgba(15, 23, 42, 1)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Refresh Stripe status
              </button>

              <button
                type="button"
                onClick={openStripeDashboard}
                disabled={stripeManageBusy || !stripeHasAccount}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background:
                    stripeManageBusy || !stripeHasAccount
                      ? "rgba(148, 163, 184, 0.18)"
                      : "rgba(248, 250, 252, 1)",
                  color:
                    stripeManageBusy || !stripeHasAccount
                      ? "rgba(15,23,42,0.55)"
                      : "rgba(15, 23, 42, 1)",
                  fontWeight: 900,
                  cursor: stripeManageBusy || !stripeHasAccount ? "not-allowed" : "pointer",
                }}
              >
                {stripeManageBusy ? "Opening Stripe…" : "Manage Stripe account"}
              </button>

              <Link
                href="/verify?manage=1"
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "rgba(248, 250, 252, 1)",
                  color: "rgba(15, 23, 42, 1)",
                  fontWeight: 900,
                  textDecoration: "none",
                }}
              >
                Manage email/phone verification
              </Link>
            </div>

            <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.35 }}>
              We’ll never show your private identity details to buyers. Stripe is used only for identity checks and
              payouts.
            </div>

            {!stripeOk && stripeChecked && (stripeQuery === "return" || stripeQuery === "refresh") ? (
              <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.35 }}>
                Stripe sometimes takes a moment to enable capabilities after onboarding. If this doesn’t turn green,
                click <b>Refresh Stripe status</b>.
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Account tools" description="Everything you can manage from your account.">
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.10)",
              background: "rgba(240,253,244,1)",
              color: "rgba(22,101,52,1)",
              fontWeight: 900,
              marginBottom: 10,
            }}
          >
            Access token balance: {accessTokenBalance}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <ToolLink
              label="Change password"
              hint="Update your password and security settings."
              href="/account/security/password"
            />
            <ToolLink
              label="Notifications"
              hint="Choose alerts for artists, teams, venues, and sold-out opportunities."
              href="/account/notifications"
            />
            <ToolLink
              label="Transaction history"
              hint="See purchases, sales, payouts, refunds, and access tokens."
              href="/account/transactions"
            />
            {me?.flags?.isAdmin ? (
              <>
                <ToolLink
                  label="Admin tools"
                  hint="Open the admin cockpit for users, sellers, orders, queues, and marketplace operations."
                  href="/admin"
                />
                <ToolLink
                  label="Admin ticket verification queue"
                  hint="Review pending/flagged ticket authenticity and approve or reject listings."
                  href="/admin/tickets/verification"
                />
              </>
            ) : null}
          </div>
        </Card>

        <Card title="My tickets" description="Quick access to tickets you’re holding, selling, or have completed.">
          {ticketOverviewError ? (
            <div
              role="alert"
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(245, 158, 11, 0.35)",
                background: "rgba(255, 251, 235, 1)",
                color: "rgba(146, 64, 14, 1)",
                fontSize: 12,
                fontWeight: 800,
                marginBottom: 10,
              }}
            >
              {ticketOverviewError}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 10 }}>
            {ticketOverview.pendingCheckout.count > 0 ? (
              <ToolLink
                label="Checkout incomplete"
                hint="Payment has not been completed yet. Finish checkout or let the reservation expire before treating these tickets as bought."
                href={
                  ticketOverview.pendingCheckout.orderId
                    ? `/checkout?orderId=${encodeURIComponent(ticketOverview.pendingCheckout.orderId)}`
                    : "/account/transactions"
                }
                count={ticketOverview.pendingCheckout.count}
                attention="required"
                attentionLabel="Payment required"
              />
            ) : null}
            <ToolLink
              label="Holding (incoming / transferred to you)"
              hint={
                ticketOverview.holding.actionRequired > 0
                  ? "Transferred tickets are waiting for you to confirm receipt."
                  : ticketOverview.holding.count > 0
                  ? "Tickets you bought are still active until transfer and final completion."
                  : "Tickets you bought that are not yet delivered or are in your possession."
              }
              href="/account/tickets/holding"
              count={ticketOverview.holding.count}
              attention={ticketOverview.holding.actionRequired > 0 ? "required" : ticketOverview.holding.count > 0 ? "active" : undefined}
              attentionLabel={ticketOverview.holding.actionRequired > 0 ? "Action required" : ticketOverview.holding.count > 0 ? "Active tickets" : undefined}
            />
            <ToolLink
              label="Selling (active listings)"
              hint={
                ticketOverview.selling.count > 0
                  ? "Tickets currently available for sale."
                  : sellerEligible
                  ? "Tickets currently listed for sale."
                  : "Locked until seller verification is complete (email + phone + Stripe)."
              }
              href="/account/tickets/selling"
              disabled={!sellerEligible}
              count={ticketOverview.selling.count}
              attention={ticketOverview.selling.count > 0 ? "active" : undefined}
              attentionLabel={ticketOverview.selling.count > 0 ? "Active listings" : undefined}
            />
            <ToolLink
              label="Seller holding (transfer required)"
              hint={
                ticketOverview.sellerHolding.actionRequired > 0
                  ? "Sold tickets need transfer proof before the deadline."
                  : ticketOverview.sellerHolding.count > 0
                  ? "Sold tickets are awaiting buyer confirmation or final completion."
                  : sellerEligible
                  ? "Sold tickets awaiting transfer or buyer confirmation."
                  : "Locked until seller verification is complete (email + phone + Stripe)."
              }
              href="/account/tickets/seller-holding"
              disabled={!sellerEligible}
              count={ticketOverview.sellerHolding.count}
              attention={
                ticketOverview.sellerHolding.actionRequired > 0
                  ? "required"
                  : ticketOverview.sellerHolding.count > 0
                  ? "active"
                  : undefined
              }
              attentionLabel={
                ticketOverview.sellerHolding.actionRequired > 0
                  ? "Transfer required"
                  : ticketOverview.sellerHolding.count > 0
                  ? "In progress"
                  : undefined
              }
            />
            <ToolLink
              label="Bought (completed)"
              hint={
                ticketOverview.bought.activeUpcoming > 0
                  ? "Completed purchases for upcoming events."
                  : "Your past purchases and receipts."
              }
              href="/account/tickets/bought"
              count={ticketOverview.bought.count}
              attention={ticketOverview.bought.activeUpcoming > 0 ? "active" : undefined}
              attentionLabel={ticketOverview.bought.activeUpcoming > 0 ? "Upcoming event" : undefined}
            />
            <ToolLink
              label="Sold (completed)"
              hint="Your past sales and payout records."
              href="/account/tickets/sold"
              count={ticketOverview.sold.count}
            />
          </div>
        </Card>

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,0,0,0.25)",
            background: "rgba(255,0,0,0.03)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, color: "rgba(160,0,0,0.95)" }}>
            Danger zone
          </h2>
          <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9 }}>
            Destructive actions. These cannot be undone.
          </p>

          <div style={{ marginTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 950, color: "rgba(160,0,0,0.95)" }}>
              Delete account
            </h3>
            <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9 }}>
              This permanently deletes your account and logs you out. For safety, you must confirm with your password.
            </p>

            {deleteError ? (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(255,0,0,0.35)",
                  background: "rgba(254, 242, 242, 1)",
                  color: "rgba(153, 27, 27, 1)",
                }}
              >
                {deleteError}
              </div>
            ) : null}

            {deleteOk ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(34, 197, 94, 0.35)",
                  background: "rgba(240, 253, 244, 1)",
                  color: "rgba(22, 101, 52, 1)",
                }}
              >
                {deleteOk}
              </div>
            ) : null}

            <form onSubmit={handleDeleteAccount} style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Password</span>
                <input
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  disabled={deleteBusy}
                  style={inputStyle(focusPw, "default")}
                  onFocus={() => setFocusPw(true)}
                  onBlur={() => setFocusPw(false)}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>
                  Type <span style={{ fontWeight: 950 }}>DELETE</span> to confirm
                </span>
                <input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  disabled={deleteBusy}
                  placeholder='Type "DELETE"'
                  style={inputStyle(focusDelete, "danger")}
                  onFocus={() => setFocusDelete(true)}
                  onBlur={() => setFocusDelete(false)}
                />
              </label>

              <button
                type="submit"
                disabled={deleteBusy}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(160,0,0,0.35)",
                  background: deleteBusy ? "rgba(160,0,0,0.25)" : "rgba(160,0,0,0.92)",
                  color: "white",
                  fontWeight: 950,
                  cursor: deleteBusy ? "not-allowed" : "pointer",
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete my account"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountContent() {
  return (
    <AccountGate
      nextPath="/account"
      loadingFallback={
        <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900 }}>Account</h1>
          <p style={{ opacity: 0.8 }}>Loading…</p>
        </div>
      }
      errorFallback={(message) => (
        <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900 }}>Account</h1>
          <div
            role="alert"
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,0,0,0.35)",
              background: "rgba(254, 242, 242, 1)",
              color: "rgba(153, 27, 27, 1)",
            }}
          >
            {message}
          </div>
        </div>
      )}
    >
      {(me) => <AccountHub me={me} />}
    </AccountGate>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 800, margin: "40px auto", padding: 16 }}><p>Loading account...</p></div>}>
      <AccountContent />
    </Suspense>
  );
}
