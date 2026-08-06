export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";

function noStoreJson(body: any, init?: ResponseInit) {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return null;
  }
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
}

/**
 * Normalize country to ISO-3166-1 alpha-2 for Stripe.
 * Default to CA if unknown (safe for your current market).
 */
function normalizeCountry(country?: string | null): string {
  if (!country) return "CA";

  const c = country.trim().toUpperCase();

  if (c === "CA" || c === "CANADA") return "CA";
  if (c === "US" || c === "USA" || c === "UNITED STATES" || c === "UNITED STATES OF AMERICA")
    return "US";

  // If already looks like a 2-letter code, trust it
  if (/^[A-Z]{2}$/.test(c)) return c;

  // Safe fallback
  return "CA";
}

function sellerDisplayName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function stripeAccountPrefill(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  streetAddress1: string;
  streetAddress2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}, seller: { id: string }, origin: string) {
  const country = normalizeCountry(user.country);
  const address = {
    line1: user.streetAddress1 || undefined,
    line2: user.streetAddress2 || undefined,
    city: user.city || undefined,
    state: user.region || undefined,
    postal_code: user.postalCode || undefined,
    country,
  };

  return {
    email: user.email,
    business_type: "individual",
    business_profile: {
      // Stripe still calls this section "Business details" for individual
      // accounts. Prefill the two commercial-activity fields so personal
      // ticket sellers do not have to choose an industry or supply a website.
      mcc: "7922",
      url: `${origin}/seller/${encodeURIComponent(seller.id)}`,
      product_description: "Individual seller listing personal event tickets at or below face value through the TrueFanTix marketplace.",
    },
    individual: {
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      phone: user.phone || undefined,
      address,
    },
    metadata: {
      userId: user.id,
      sellerId: seller.id,
      platform: "TrueFanTix",
    },
  };
}

export async function POST(req: Request) {
  try {
    const gate = await requireVerifiedUser(req);
    if (!gate.ok) return gate.res;

    const rateLimit = await applyRateLimit(req, "seller:onboarding:start");
    if (!rateLimit.ok) return rateLimit.response;

    const userId = gate.user.id;
    const origin = new URL(req.url).origin;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { seller: true },
    });

    if (!user || user.isBanned) {
      return noStoreJson({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!user.emailVerifiedAt || !user.phoneVerifiedAt) {
      return noStoreJson(
        {
          ok: false,
          error: "NOT_VERIFIED",
          message: "Verify your email and phone before starting seller verification.",
        },
        { status: 403 }
      );
    }

    const stripe = await getStripe();
    if (!stripe) {
      return noStoreJson(
        {
          ok: false,
          error: "STRIPE_NOT_CONFIGURED",
          message: "Seller verification is temporarily unavailable while Stripe setup is completed.",
        },
        { status: 503 }
      );
    }

    // Ensure seller record exists
    let seller = user.seller;

    if (!seller) {
      seller = await prisma.seller.create({
        data: {
          name: sellerDisplayName(user),
          status: "PENDING",
          statusUpdatedAt: new Date(),
          user: { connect: { id: user.id } },
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { sellerId: seller.id },
      });
    }

    // Create Stripe account if needed
    if (!seller.stripeAccountId) {
      const country = normalizeCountry(user.country);
      const prefill = stripeAccountPrefill(user, seller, origin);

      const account = await stripe.accounts.create({
        type: "express",
        country,
        ...prefill,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          userId: user.id,
          sellerId: seller.id,
        },
      });

      seller = await prisma.seller.update({
        where: { id: seller.id },
        data: {
          stripeAccountId: account.id,
          stripeDetailsSubmitted: !!account.details_submitted,
          stripeChargesEnabled: !!account.charges_enabled,
          stripePayoutsEnabled: !!account.payouts_enabled,
        },
      });
    } else {
      try {
        await stripe.accounts.update(seller.stripeAccountId, stripeAccountPrefill(user, seller, origin));
      } catch (err) {
        console.warn("Could not prefill existing Stripe connected account:", err);
      }
    }

    const link = await stripe.accountLinks.create({
      account: seller.stripeAccountId!,
      refresh_url: `${origin}/account?stripe=refresh`,
      return_url: `${origin}/account?stripe=return`,
      type: "account_onboarding",
    });

    return noStoreJson({ ok: true, url: link.url }, { status: 200 });
  } catch (err: any) {
    console.error("POST /api/sellers/onboarding/start failed:", err);
    return noStoreJson(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
