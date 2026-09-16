export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  ManagedAccountSellerOnboardingError,
  SellerAccountAuthorizationChangedError,
  SellerAccountMissingError,
  SellerOnboardingVerificationError,
  authorizeSellerLinkSnapshot,
} from "@/lib/sellers/ordinary-onboarding";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
}

export async function POST(req: Request) {
  try {
    const gate = await requireVerifiedUser(req);
    if (!gate.ok) return gate.res;

    const rateLimit = await applyRateLimit(req, "seller:onboarding:login");
    if (!rateLimit.ok) return rateLimit.response;

    const stripe = await getStripe();
    if (!stripe) {
      return noStoreJson(
        {
          ok: false,
          error: "STRIPE_NOT_CONFIGURED",
          message: "Seller verification is temporarily unavailable while Stripe setup is completed.",
        },
        { status: 503 },
      );
    }

    // The authorization transaction resolves before createLoginLink and no
    // transaction client or mutable ORM object crosses this boundary.
    const snapshot = await authorizeSellerLinkSnapshot(gate.user.id, "LOGIN");
    const link = await stripe.accounts.createLoginLink(snapshot.stripeAccountId);
    return noStoreJson({ ok: true, url: link.url }, { status: 200 });
  } catch (error: any) {
    if (error instanceof ManagedAccountSellerOnboardingError) {
      return noStoreJson(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403 },
      );
    }
    if (error instanceof SellerOnboardingVerificationError) {
      return noStoreJson(
        { ok: false, error: "NOT_VERIFIED", message: "Please verify your email and phone number." },
        { status: 403 },
      );
    }
    if (error instanceof SellerAccountMissingError) {
      return noStoreJson(
        {
          ok: false,
          error: "STRIPE_ACCOUNT_MISSING",
          message: "Start seller verification before opening the Stripe dashboard.",
        },
        { status: 409 },
      );
    }
    if (error instanceof SellerAccountAuthorizationChangedError) {
      return noStoreJson(
        { ok: false, error: "SELLER_ONBOARDING_AUTHORIZATION_CHANGED", retrySafe: false },
        { status: 409 },
      );
    }
    console.error("POST /api/sellers/onboarding/login failed:", error);
    return noStoreJson(
      { ok: false, error: "SERVER_ERROR", message: String(error?.message ?? error) },
      { status: 500 },
    );
  }
}
