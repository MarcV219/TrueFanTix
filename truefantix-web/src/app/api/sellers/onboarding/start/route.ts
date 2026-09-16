export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  ManagedAccountSellerOnboardingError,
  SellerAccountAuthorizationChangedError,
  SellerAccountMissingError,
  SellerAccountReconciliationRequiredError,
  SellerOnboardingVerificationError,
  authorizeSellerAccountStart,
  authorizeSellerLinkSnapshot,
  canonicalSellerOnboardingOrigin,
  claimLegacySellerAccountCommand,
  finalizeLegacySellerAccountCommand,
  markSellerAccountReconciliationRequired,
  resolveSellerAccountCommand,
  sellerAccountCreateParams,
  sellerAccountProviderEvidence,
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

function reconciliationResponse() {
  return noStoreJson(
    {
      ok: false,
      error: "SELLER_ACCOUNT_RECONCILIATION_REQUIRED",
      message: "Seller verification needs operations review before it can continue.",
      retrySafe: false,
    },
    { status: 409 },
  );
}

export async function POST(req: Request) {
  try {
    const gate = await requireVerifiedUser(req);
    if (!gate.ok) return gate.res;

    const rateLimit = await applyRateLimit(req, "seller:onboarding:start");
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

    const origin = canonicalSellerOnboardingOrigin();
    const authorization = await authorizeSellerAccountStart(gate.user.id, origin);
    if (authorization.kind === "COMMAND") {
      const claimed = await claimLegacySellerAccountCommand(authorization.command.id);
      if (!claimed) {
        await resolveSellerAccountCommand(authorization.command.id);
      } else {
        let account: Record<string, unknown>;
        try {
          account = await stripe.accounts.create(
            sellerAccountCreateParams(claimed),
            { idempotencyKey: claimed.idempotencyKey },
          );
        } catch {
          await markSellerAccountReconciliationRequired(
            claimed.id,
            "PROVIDER_OUTCOME_UNKNOWN",
          ).catch(() => undefined);
          return reconciliationResponse();
        }

        const evidence = sellerAccountProviderEvidence(account);
        if (!evidence) {
          await markSellerAccountReconciliationRequired(
            claimed.id,
            "PROVIDER_EVIDENCE_INCOMPLETE",
          ).catch(() => undefined);
          return reconciliationResponse();
        }

        try {
          await finalizeLegacySellerAccountCommand(claimed.id, evidence);
        } catch {
          await markSellerAccountReconciliationRequired(
            claimed.id,
            "PROVIDER_SUCCESS_LOCAL_FINALIZATION_FAILED",
            evidence,
          ).catch(() => undefined);
          return reconciliationResponse();
        }
      }
    }

    // This transaction commits before accountLinks.create. Only the primitive
    // snapshot below crosses the provider boundary.
    const snapshot = await authorizeSellerLinkSnapshot(gate.user.id, "ONBOARDING", origin);
    const link = await stripe.accountLinks.create({
      account: snapshot.stripeAccountId,
      refresh_url: snapshot.refreshUrl!,
      return_url: snapshot.returnUrl!,
      type: "account_onboarding",
    });
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
        {
          ok: false,
          error: "NOT_VERIFIED",
          message: "Verify your email and phone before starting seller verification.",
        },
        { status: 403 },
      );
    }
    if (error instanceof SellerAccountReconciliationRequiredError) return reconciliationResponse();
    if (error instanceof SellerAccountAuthorizationChangedError) {
      return noStoreJson(
        {
          ok: false,
          error: "SELLER_ONBOARDING_AUTHORIZATION_CHANGED",
          message: "Seller verification details changed after authorization and need review.",
          retrySafe: false,
        },
        { status: 409 },
      );
    }
    if (error instanceof SellerAccountMissingError) return reconciliationResponse();
    console.error("POST /api/sellers/onboarding/start failed:", error);
    return noStoreJson(
      { ok: false, error: "SERVER_ERROR", message: String(error?.message ?? error) },
      { status: 500 },
    );
  }
}
