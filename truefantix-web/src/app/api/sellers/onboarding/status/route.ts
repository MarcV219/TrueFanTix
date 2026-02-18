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
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
}

// Helper: treat Stripe capability "active" as the source of truth
function isActiveCapability(value: unknown) {
  return String(value ?? "").toLowerCase() === "active";
}

export async function GET() {
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

    const seller = user.seller;

    if (!seller || !seller.stripeAccountId) {
      return noStoreJson(
        {
          ok: true,
          stripe: {
            hasAccount: false,
            detailsSubmitted: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            fullyEnabled: false,
            // debug
            capabilities: null,
            requirements: null,
          },
        },
        { status: 200 }
      );
    }

    const stripe = await getStripe();
    const acct: any = await stripe.accounts.retrieve(seller.stripeAccountId);

    const detailsSubmitted = !!acct?.details_submitted;

    // Legacy booleans (sometimes lag / not the best signal)
    const chargesEnabledLegacy = !!acct?.charges_enabled;
    const payoutsEnabledLegacy = !!acct?.payouts_enabled;

    // Capabilities are the best signal for Connect
    const cap = acct?.capabilities ?? {};
    const cardPaymentsActive = isActiveCapability(cap?.card_payments);
    const transfersActive = isActiveCapability(cap?.transfers);

    // “Enabled” for our platform = can accept payments + can transfer/payout
    const chargesEnabled = chargesEnabledLegacy || cardPaymentsActive;
    const payoutsEnabled = payoutsEnabledLegacy || transfersActive;

    const requirements = acct?.requirements
      ? {
          currently_due: Array.isArray(acct.requirements.currently_due)
            ? acct.requirements.currently_due
            : [],
          eventually_due: Array.isArray(acct.requirements.eventually_due)
            ? acct.requirements.eventually_due
            : [],
          past_due: Array.isArray(acct.requirements.past_due) ? acct.requirements.past_due : [],
          disabled_reason: acct.requirements.disabled_reason ?? null,
        }
      : null;

    const fullyEnabled = detailsSubmitted && chargesEnabled && payoutsEnabled;

    // Store what Stripe says (source of truth)
    await prisma.seller.update({
      where: { id: seller.id },
      data: {
        stripeDetailsSubmitted: detailsSubmitted,
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
      },
    });

    // If fully enabled, approve seller + allow selling
    if (fullyEnabled) {
      await prisma.seller.update({
        where: { id: seller.id },
        data: {
          status: "APPROVED",
          statusUpdatedAt: new Date(),
          statusReason: null,
        },
      });

      if (!user.canSell) {
        await prisma.user.update({
          where: { id: user.id },
          data: { canSell: true },
        });
      }
    }

    return noStoreJson(
      {
        ok: true,
        stripe: {
          hasAccount: true,
          detailsSubmitted,
          chargesEnabled,
          payoutsEnabled,
          fullyEnabled,
          // debug (helps us if Stripe still disagrees)
          capabilities: {
            card_payments: cap?.card_payments ?? null,
            transfers: cap?.transfers ?? null,
          },
          requirements,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/sellers/onboarding/status failed:", err);
    const message = err?.message ? String(err.message) : "SERVER_ERROR";
    return noStoreJson({ ok: false, error: "SERVER_ERROR", message }, { status: 500 });
  }
}
