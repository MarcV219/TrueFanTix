"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useNavHistory } from "@/app/_components/navhistory";

type MeUser = {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
  flags?: {
    isVerified?: boolean;
    isSellerApproved?: boolean;
    isAdmin?: boolean;
  };
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

function normalizePath(p: string | null) {
  if (!p) return null;
  return p.split("?")[0].split("#")[0];
}

function labelForPath(path: string) {
  const map: Record<string, string> = {
    "/": "Home",
    "/account": "Account",
    "/account/profile": "Profile",
    "/account/security/password": "Change password",
    "/account/notifications": "Notifications",
    "/account/transactions": "Transaction history",
    "/account/tickets/holding": "Tickets — Holding",
    "/account/tickets/selling": "Tickets — Selling",
    "/account/tickets/bought": "Tickets — Bought",
    "/account/tickets/sold": "Tickets — Sold",
    "/forum": "Forum",
    "/tickets": "Tickets",
    "/verify": "Verify",
    "/login": "Login",
    "/register": "Create account",
  };

  if (map[path]) return map[path];
  if (path.startsWith("/account/tickets")) return "My tickets";
  if (path.startsWith("/account")) return "Account";
  if (path.startsWith("/forum")) return "Forum";
  if (path.startsWith("/tickets")) return "Tickets";
  return path;
}

function NavPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={[
        "no-underline whitespace-nowrap font-semibold text-sm px-3 py-2 rounded-lg border transition",
        active
          ? "border-[rgba(6,74,147,0.35)] bg-[rgba(6,74,147,0.08)] text-[var(--tft-navy)]"
          : "border-[var(--border)] bg-white/70 dark:bg-white/5 text-[var(--foreground)] hover:bg-black/5 dark:hover:bg-white/10",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

function computeBackTarget(prev: string | null, current: string, isLoggedIn: boolean) {
  if (!prev) return null;
  if (prev === current) return null;

  // If we just logged in, nav history often says /login but the user expects Home.
  if (isLoggedIn && (prev === "/login" || prev === "/register")) return "/";

  // Safety: never “back” to logout endpoints or similar in future
  return prev;
}

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const { previousPath } = useNavHistory();

  const prev = normalizePath(previousPath);
  const current = normalizePath(pathname) || "/";

  const [me, setMe] = React.useState<MeUser | null>(null);
  const [meLoaded, setMeLoaded] = React.useState(false);
  const [logoutBusy, setLogoutBusy] = React.useState(false);

  const isLoggedIn = !!me;

  const backTarget = computeBackTarget(prev, current, isLoggedIn);
  const showBack = current !== "/" && !!backTarget;
  const backLabel = backTarget ? labelForPath(backTarget) : "Back";

  const isAccount = current.startsWith("/account");
  const isForum = current.startsWith("/forum");
  const isTickets = current.startsWith("/tickets");
  const isHome = current === "/";

  const displayName =
    me?.displayName?.trim() || (me ? `${me.firstName} ${me.lastName}` : "");

  const emailVerified = !!me?.emailVerifiedAt;
  const phoneVerified = !!me?.phoneVerifiedAt;
  const fullyVerified =
    (me?.flags && me.flags.isVerified === true) || (emailVerified && phoneVerified);

  async function refreshMe() {
    try {
      const { res, data } = await fetchJson("/api/auth/me", { cache: "no-store" });

      // Preferred behavior: 200 + { ok:true, user:null } when logged out
      if (res.ok && data && (data as any).ok === true) {
        const user = (data as any).user as MeUser | null;
        setMe(user ?? null);
        setMeLoaded(true);
        return;
      }

      // Back-compat: treat 401 as logged out
      if (res.status === 401) {
        setMe(null);
        setMeLoaded(true);
        return;
      }

      setMe(null);
      setMeLoaded(true);
    } catch {
      setMe(null);
      setMeLoaded(true);
    }
  }

  // Initial mount
  React.useEffect(() => {
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route change (layout/header stays mounted)
  React.useEffect(() => {
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Tab becomes visible again
  React.useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") refreshMe();
    }
    window.addEventListener("visibilitychange", onVisibility);
    return () => window.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    if (logoutBusy) return;
    setLogoutBusy(true);

    try {
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" }).catch(() => undefined);
    } finally {
      setMe(null);
      setMeLoaded(true);
      window.location.assign("/");
    }
  }

  function goBack() {
    if (backTarget) router.push(backTarget);
  }

  return (
    <header className="sticky top-0 z-50 bg-[var(--background)]/90 backdrop-blur border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* Left: Logo + optional Back */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-3 min-w-0">
            <Image
              src="/brand/truefantix-lockup.jpeg"
              alt="TrueFanTix"
              width={220}
              height={56}
              priority
              className="h-10 w-auto"
            />
          </Link>

          {showBack ? (
            <button
              type="button"
              onClick={goBack}
              className="hidden md:inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-white/70 dark:bg-white/5 text-sm font-semibold text-[var(--foreground)] hover:bg-black/5 dark:hover:bg-white/10 transition"
              aria-label={`Back to ${backLabel}`}
              title={`Back to ${backLabel}`}
            >
              <span aria-hidden>←</span>
              <span className="max-w-[220px] truncate">Back to {backLabel}</span>
            </button>
          ) : null}
        </div>

        {/* Right: Primary nav + auth actions */}
        <nav className="flex items-center gap-2 flex-wrap justify-end">
          <NavPill href="/" label="Home" active={isHome} />
          <NavPill href="/tickets" label="Tickets" active={isTickets} />
          <NavPill href="/forum" label="Forum" active={isForum} />
          <NavPill href="/account" label="Account" active={isAccount} />
          {me?.flags?.isAdmin ? (
            <NavPill href="/admin/tickets/verification" label="Admin Queue" active={current.startsWith("/admin/tickets/verification")} />
          ) : null}

          {meLoaded ? (
            isLoggedIn ? (
              <button
                type="button"
                onClick={handleLogout}
                disabled={logoutBusy}
                className="ml-1 text-sm font-semibold text-[var(--tft-teal)] hover:text-[var(--tft-teal-dark)] transition disabled:opacity-50"
              >
                {logoutBusy ? "Logging out..." : "Log out"}
              </button>
            ) : (
              <>
                <Link
                  href="/login"
                  className="ml-1 text-sm font-semibold text-[var(--tft-teal)] hover:text-[var(--tft-teal-dark)] transition"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="button-primary px-4 py-2 rounded-lg text-sm font-semibold shadow-sm hover:shadow transition"
                >
                  Create account
                </Link>
              </>
            )
          ) : null}
        </nav>
      </div>

      {/* Status row ONLY (no extra Account link) */}
      <div className="border-t border-[var(--border)] bg-[var(--background)]/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 text-sm text-[var(--foreground)]/80">
          {!meLoaded ? (
            <span>Checking session…</span>
          ) : isLoggedIn ? (
            <span>
              Signed in as{" "}
              <span className="font-semibold text-[var(--foreground)]">{displayName}</span>
              {fullyVerified ? "" : " (not verified)"}
            </span>
          ) : (
            <span>Not signed in</span>
          )}
        </div>
      </div>

      {/* Mobile back row */}
      {showBack ? (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--background)]/95">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
            <button
              type="button"
              onClick={goBack}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-white/70 dark:bg-white/5 text-sm font-semibold text-[var(--foreground)] hover:bg-black/5 dark:hover:bg-white/10 transition"
              aria-label={`Back to ${backLabel}`}
              title={`Back to ${backLabel}`}
            >
              <span aria-hidden>←</span>
              <span className="truncate">Back to {backLabel}</span>
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
