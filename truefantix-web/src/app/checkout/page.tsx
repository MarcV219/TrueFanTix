"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { CheckoutForm } from "@/components/CheckoutForm";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
      return Promise.resolve(null);
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
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

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [order, setOrder] = useState<any>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setError("No order ID provided.");
      setIsLoading(false);
      return;
    }

    async function loadOrderAndIntent() {
      // First, get order details
      const orderRes = await fetchJson(`/api/orders/${orderId}`);
      if (!orderRes.res.ok) {
        setError(orderRes.data?.message || "Failed to load order.");
        setIsLoading(false);
        return;
      }

      setOrder(orderRes.data?.order);

      // Then create payment intent
      const intentRes = await fetchJson("/api/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });

      if (!intentRes.res.ok) {
        setError(intentRes.data?.message || "Failed to initialize payment.");
        setIsLoading(false);
        return;
      }

      setClientSecret(intentRes.data?.clientSecret);
      setAmount(intentRes.data?.amount);
      setIsLoading(false);
    }

    loadOrderAndIntent();
  }, [orderId]);

  const handlePaymentSuccess = () => {
    setPaymentSuccess(true);
    // Redirect to success page after a moment
    setTimeout(() => {
      router.push(`/checkout/success?orderId=${orderId}`);
    }, 1500);
  };

  const handlePaymentError = (message: string) => {
    setError(message);
  };

  if (paymentSuccess) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: 16 }}>
        <div
          style={{
            padding: 24,
            borderRadius: 12,
            border: "1px solid rgba(34, 197, 94, 0.35)",
            background: "rgba(240, 253, 244, 1)",
            color: "rgba(22, 101, 52, 1)",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 8 }}>Payment Successful! 🎉</div>
          <div>Your order has been confirmed.</div>
          <div style={{ marginTop: 8, opacity: 0.8 }}>Redirecting to your tickets...</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: 16, textAlign: "center" }}>
        <div style={{ opacity: 0.8 }}>Loading checkout...</div>
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
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Error</div>
          <div>{error}</div>
        </div>
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Link href="/account/tickets/bought" style={{ textDecoration: "underline" }}>
            View your orders
          </Link>
        </div>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: 16 }}>
        <div role="alert" style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(255,0,0,0.35)", background: "rgba(254, 242, 242, 1)", color: "rgba(153, 27, 27, 1)" }}>
          Failed to initialize payment. Please try again.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Checkout</h1>
      
      {order && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.10)",
            background: "rgba(248, 250, 252, 1)",
            marginBottom: 20,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Order Summary</div>
          <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Subtotal:</span>
              <span>${centsToDollars(order.amountCents)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Service Fee:</span>
              <span>${centsToDollars(order.adminFeeCents)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
                paddingTop: 8,
                borderTop: "1px solid rgba(0,0,0,0.10)",
                marginTop: 4,
              }}
            >
              <span>Total:</span>
              <span>${centsToDollars(order.totalCents)} CAD</span>
            </div>
          </div>
        </div>
      )}

      <Elements
        stripe={getStripePromise()}
        options={{
          clientSecret,
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: "#2563eb",
            },
          },
        }}
      >
        <CheckoutForm
          orderId={orderId!}
          amount={amount}
          onSuccess={handlePaymentSuccess}
          onError={handlePaymentError}
        />
      </Elements>

      <div style={{ marginTop: 16, textAlign: "center" }}>
        <Link href="/" style={{ textDecoration: "underline", opacity: 0.8 }}>
          Cancel and return to browsing
        </Link>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div style={{ maxWidth: 600, margin: "40px auto", padding: 16, textAlign: "center" }}>
          <div style={{ opacity: 0.8 }}>Loading checkout...</div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
