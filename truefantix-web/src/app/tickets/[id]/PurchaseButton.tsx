"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/api-fetch";

type PurchaseButtonProps = {
  ticketId: string;
  price: string;
};

type MeResponse =
  | {
      ok: true;
      user: {
        sellerId: string | null;
        canBuy?: boolean;
        emailVerifiedAt: string | null;
        phoneVerifiedAt: string | null;
        flags?: { isVerified?: boolean };
      } | null;
    }
  | { ok: false; error?: string; message?: string };

function isVerified(user: NonNullable<Extract<MeResponse, { ok: true }>["user"]>) {
  if (user.flags?.isVerified === true) return true;
  return !!user.emailVerifiedAt && !!user.phoneVerifiedAt;
}

function buildIdempotencyKey(ticketId: string) {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `ticket-${ticketId}-${random}`.slice(0, 100);
}

export default function PurchaseButton({ ticketId, price }: PurchaseButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticketPath = useMemo(() => `/tickets/${ticketId}`, [ticketId]);

  async function redirectForGate(status: number, data: any) {
    const errorCode = String(data?.error || "").toUpperCase();

    if (status === 401 || errorCode === "NOT_AUTHENTICATED") {
      router.push(`/login?next=${encodeURIComponent(ticketPath)}`);
      return true;
    }

    if (status === 403 && errorCode === "NOT_VERIFIED") {
      router.push(`/verify?next=${encodeURIComponent(ticketPath)}`);
      return true;
    }

    return false;
  }

  async function handleClick() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const meResult = await fetchJson("/api/auth/me", { cache: "no-store" });
      const me = meResult.data as MeResponse | null;

      if (!meResult.res.ok || !me || me.ok !== true || !me.user) {
        router.push(`/login?next=${encodeURIComponent(ticketPath)}`);
        return;
      }

      if (!isVerified(me.user)) {
        router.push(`/verify?next=${encodeURIComponent(ticketPath)}`);
        return;
      }

      if (me.user.canBuy === false) {
        setError("Buying is disabled for this account.");
        return;
      }

      const buyerResult = await fetchJson("/api/auth/ensure-buyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!buyerResult.res.ok) {
        if (await redirectForGate(buyerResult.res.status, buyerResult.data)) return;
        setError(buyerResult.data?.message || buyerResult.data?.error || "Could not prepare your buyer account.");
        return;
      }

      const buyerSellerId = buyerResult.data?.sellerId || me.user.sellerId;
      if (!buyerSellerId) {
        setError("Could not prepare your buyer account.");
        return;
      }

      const idempotencyKey = buildIdempotencyKey(ticketId);
      const checkoutResult = await fetchJson("/api/orders/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          ticketIds: [ticketId],
          buyerSellerId,
          idempotencyKey,
        }),
      });

      if (!checkoutResult.res.ok) {
        if (await redirectForGate(checkoutResult.res.status, checkoutResult.data)) return;
        setError(checkoutResult.data?.message || checkoutResult.data?.error || "Could not reserve this ticket.");
        return;
      }

      const orderId = checkoutResult.data?.order?.id;
      if (!orderId) {
        setError("Could not start checkout for this ticket.");
        return;
      }

      router.push(`/checkout?orderId=${encodeURIComponent(orderId)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-busy={busy}
        className="w-full bg-[var(--tft-navy)] text-white py-4 rounded-lg font-bold text-lg hover:bg-[var(--tft-navy-dark)] transition disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {busy ? "Preparing checkout..." : `Buy Ticket - ${price}`}
      </button>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
