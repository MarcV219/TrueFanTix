export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

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
    throw new Error("Missing STRIPE_SECRET_KEY in environment.");
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

export async function POST(req: Request) {
  try {
    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return noStoreJson({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

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

    // Ensure seller record exists
    let seller = user.seller;

    if (!seller) {
      seller = await prisma.seller.create({
        data: {
          name: `${user.firstName} ${user.lastName}`.trim(),
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

      const account = await stripe.accounts.create({
        type: "express",
        country,
        email: user.email,
        business_type: "individual",
        capabilities: {
          card_payments: { requested: true },
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
    }

    const origin = new URL(req.url).origin;

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
