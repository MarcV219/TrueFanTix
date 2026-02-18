"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";

interface StripeContextType {
  stripe: Stripe | null;
  isLoading: boolean;
}

const StripeContext = createContext<StripeContextType>({ stripe: null, isLoading: true });

export function useStripe() {
  return useContext(StripeContext);
}

interface StripeProviderProps {
  children: React.ReactNode;
}

export function StripeProvider({ children }: StripeProviderProps) {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      console.error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
      setIsLoading(false);
      return;
    }

    loadStripe(publishableKey)
      .then((stripeInstance) => {
        setStripe(stripeInstance);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load Stripe:", err);
        setIsLoading(false);
      });
  }, []);

  return (
    <StripeContext.Provider value={{ stripe, isLoading }}>
      {children}
    </StripeContext.Provider>
  );
}
