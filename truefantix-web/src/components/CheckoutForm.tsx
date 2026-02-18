"use client";

import React, { useState } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

interface CheckoutFormProps {
  orderId: string;
  amount: number;
  onSuccess: () => void;
  onError: (message: string) => void;
}

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function CheckoutForm({ orderId, amount, onSuccess, onError }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      onError("Stripe is not loaded yet. Please wait a moment and try again.");
      return;
    }

    setIsProcessing(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/complete`,
      },
      redirect: "if_required",
    });

    if (error) {
      setIsProcessing(false);
      onError(error.message || "Payment failed. Please try again.");
      return;
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      setIsProcessing(false);
      onSuccess();
    } else {
      setIsProcessing(false);
      onError("Payment is processing. Please check your order status.");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "white",
        }}
      >
        <div style={{ fontWeight: 950, fontSize: 18, marginBottom: 16 }}>
          Payment Details
        </div>
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>

      <button
        type="submit"
        disabled={!stripe || isProcessing}
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px solid rgba(37, 99, 235, 0.35)",
          background: !stripe || isProcessing
            ? "rgba(37, 99, 235, 0.55)"
            : "rgba(37, 99, 235, 1)",
          color: "white",
          fontWeight: 800,
          fontSize: 16,
          cursor: !stripe || isProcessing ? "not-allowed" : "pointer",
          opacity: !stripe || isProcessing ? 0.7 : 1,
        }}
      >
        {isProcessing ? "Processing..." : `Pay $${centsToDollars(amount)} CAD`}
      </button>

      <div style={{ fontSize: 12, opacity: 0.7, textAlign: "center" }}>
        Your payment is secured by Stripe. We never store your card details.
      </div>
    </form>
  );
}
