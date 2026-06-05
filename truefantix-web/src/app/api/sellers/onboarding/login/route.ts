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

    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      include: { seller: true },
    });

    if (!user || user.isBanned) {
      return noStoreJson({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!user.seller?.stripeAccountId) {
      return noStoreJson(
        {
          ok: false,
          error: "STRIPE_ACCOUNT_MISSING",
          message: "Start seller verification before opening the Stripe dashboard.",
        },
        { status: 409 }
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

    const link = await stripe.accounts.createLoginLink(user.seller.stripeAccountId);
    return noStoreJson({ ok: true, url: link.url }, { status: 200 });
  } catch (err: any) {
    console.error("POST /api/sellers/onboarding/login failed:", err);
    return noStoreJson(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
