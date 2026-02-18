"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

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
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  const [isLoading, setIsLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setError("No order ID provided.");
      setIsLoading(false);
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

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", padding: 16 }}>
      <div
        style={{
          padding: 32,
          borderRadius: 16,
          border: "1px solid rgba(34, 197, 94, 0.35)",
          background: "rgba(240, 253, 244, 1)",
          color: "rgba(22, 101, 52, 1)",
          textAlign: "center",
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
        <div style={{ fontWeight: 800, fontSize: 28, marginBottom: 8 }}>Payment Successful!</div>
        <div style={{ opacity: 0.9 }}>Your order has been confirmed and payment received.</div>
      </div>

      {order && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.10)",
            background: "white",
            marginBottom: 20,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>Order Details</div>
          
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ opacity: 0.7 }}>Order ID:</span>
              <span style={{ fontFamily: "monospace" }}>{order.id.slice(0, 12)}...</span>
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ opacity: 0.7 }}>Status:</span>
              <span style={{ fontWeight: 600 }}>{order.status}</span>
            </div>

            <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "4px 0" }} />

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span>Subtotal:</span>
              <span>${centsToDollars(order.amountCents)}</span>
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span>Service Fee:</span>
              <span>${centsToDollars(order.adminFeeCents)}</span>
            </div>
            
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16 }}>
              <span>Total Paid:</span>
              <span>${centsToDollars(order.totalCents)} CAD</span>
            </div>
          </div>

          {order.items && order.items.length > 0 && (
            <>
              <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "16px 0" }} />
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Tickets:</div>
              <div style={{ display: "grid", gap: 8 }}>
                {order.items.map((item: any) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: "1px solid rgba(0,0,0,0.06)",
                      background: "rgba(248, 250, 252, 1)",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{item.ticket?.title || "Ticket"}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {item.ticket?.venue} • {item.ticket?.date}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <Link
          href="/account/tickets/bought"
          style={{
            padding: "12px 24px",
            borderRadius: 10,
            border: "1px solid rgba(37, 99, 235, 0.35)",
            background: "rgba(37, 99, 235, 1)",
            color: "white",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          View My Tickets
        </Link>
        <Link
          href="/"
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
          Continue Browsing
        </Link>
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
