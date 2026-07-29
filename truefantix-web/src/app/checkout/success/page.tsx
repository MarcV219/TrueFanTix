"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getCheckoutCompletionState } from "@/lib/orderPresentation";
import { buildCheckoutHoldingUrl } from "@/components/CheckoutForm";

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

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  const [isLoading, setIsLoading] = useState(Boolean(orderId));
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState<string | null>(orderId ? null : "No order ID provided.");

  useEffect(() => {
    if (!orderId) {
      return;
    }

    async function loadOrder() {
      const { res, data } = await fetchJson(`/api/orders/${orderId}`);
      if (!res.ok) {
        setError(data?.message || "Failed to load order details.");
        setIsLoading(false);
        return;
      }

      setOrder(data?.order);
      setIsLoading(false);
    }

    loadOrder();
  }, [orderId]);

  const completionState = getCheckoutCompletionState(order);

  useEffect(() => {
    if (completionState !== "complete" || !orderId) return;
    router.replace(buildCheckoutHoldingUrl(orderId));
  }, [completionState, orderId, router]);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: 16, textAlign: "center" }}>
        <div style={{ opacity: 0.8 }}>Loading order details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: 16 }}>
        <div
          role="alert"
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,0,0,0.35)",
            background: "rgba(254, 242, 242, 1)",
            color: "rgba(153, 27, 27, 1)",
          }}
        >
          {error}
        </div>
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Link href="/account/tickets/bought" style={{ textDecoration: "underline" }}>
            View your tickets
          </Link>
        </div>
      </div>
    );
  }

  const orderStatus = String(order?.status ?? "PENDING");
  const paymentStatus = String(order?.payment?.status ?? "REQUIRES_PAYMENT");

  if (completionState !== "complete") {
    const isFailed = completionState === "failed";
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: 16 }}>
        <div
          role="alert"
          style={{
            padding: 24,
            borderRadius: 12,
            border: isFailed ? "1px solid rgba(220, 38, 38, 0.35)" : "1px solid rgba(217, 119, 6, 0.45)",
            background: isFailed ? "rgba(254, 242, 242, 1)" : "rgba(255, 251, 235, 1)",
            color: isFailed ? "rgba(153, 27, 27, 1)" : "rgba(146, 64, 14, 1)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 24, marginBottom: 8 }}>
            {isFailed ? "Checkout was not completed" : "Payment still needs attention"}
          </div>
          <div style={{ lineHeight: 1.5 }}>
            {isFailed
              ? "This order cannot be treated as bought because payment did not complete successfully."
              : "This order is reserved, but payment has not been confirmed yet. Complete payment before expecting ticket transfer instructions or email notifications."}
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 4, fontSize: 13 }}>
            <div>
              Order status: <b>{orderStatus}</b>
            </div>
            <div>
              Payment status: <b>{paymentStatus}</b>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 16 }}>
          {!isFailed ? (
            <Link
              href={`/checkout?orderId=${encodeURIComponent(orderId || "")}`}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: "1px solid rgba(217, 119, 6, 0.45)",
                background: "rgba(217, 119, 6, 1)",
                color: "white",
                textDecoration: "none",
                fontWeight: 800,
              }}
            >
              Finish Payment
            </Link>
          ) : null}
          <Link
            href="/account"
            style={{
              padding: "12px 24px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.18)",
              background: "rgba(248, 250, 252, 1)",
              color: "rgba(15, 23, 42, 1)",
              textDecoration: "none",
              fontWeight: 800,
            }}
          >
            Back to Account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", padding: 16, textAlign: "center" }}>
      <div
        style={{
          padding: 24,
          borderRadius: 16,
          border: "1px solid rgba(34, 197, 94, 0.35)",
          background: "rgba(240, 253, 244, 1)",
          color: "rgba(22, 101, 52, 1)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 8 }}>Payment Successful! 🎉</div>
        <div>Taking you to My Tickets — Holding…</div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div style={{ maxWidth: 600, margin: "40px auto", padding: 16, textAlign: "center" }}>
          <div style={{ opacity: 0.8 }}>Loading...</div>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
