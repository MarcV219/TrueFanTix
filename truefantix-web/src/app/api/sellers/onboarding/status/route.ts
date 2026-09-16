export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { instantPayoutDestination, instantPayoutStatusLabel } from "@/lib/payouts/instantPayout";
import {
  authorizeSellerStatusSnapshot,
  ManagedAccountSellerOnboardingError,
  persistSellerStatusSnapshot,
  SellerAccountAuthorizationChangedError,
  SellerOnboardingAccountNotFoundError,
  SellerOnboardingVerificationError,
} from "@/lib/sellers/ordinary-onboarding";

function noStoreJson(body: any, init?: ResponseInit) {
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

// Helper: treat Stripe capability "active" as the source of truth
function isActiveCapability(value: unknown) {
  return String(value ?? "").toLowerCase() === "active";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function boundedAccountEvidence(account: unknown, expectedAccountId: string) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    throw new SellerAccountAuthorizationChangedError("Stripe returned malformed seller account evidence");
  }
  const source = account as Record<string, unknown>;
  if (
    source.deleted === true
    || source.id !== expectedAccountId
    || typeof source.details_submitted !== "boolean"
    || typeof source.charges_enabled !== "boolean"
    || typeof source.payouts_enabled !== "boolean"
    || !source.capabilities
    || typeof source.capabilities !== "object"
    || Array.isArray(source.capabilities)
  ) {
    throw new SellerAccountAuthorizationChangedError("Stripe returned invalid seller account evidence");
  }

  const capabilities = source.capabilities as Record<string, unknown>;
  const requirementsSource = source.requirements;
  const requirements = requirementsSource && typeof requirementsSource === "object" && !Array.isArray(requirementsSource)
    ? requirementsSource as Record<string, unknown>
    : null;
  const detailsSubmitted = source.details_submitted;
  const chargesEnabled = source.charges_enabled || isActiveCapability(capabilities.card_payments);
  const payoutsEnabled = source.payouts_enabled || isActiveCapability(capabilities.transfers);

  return {
    accountId: expectedAccountId,
    detailsSubmitted,
    chargesEnabled,
    payoutsEnabled,
    fullyEnabled: detailsSubmitted && payoutsEnabled,
    capabilities: {
      card_payments: typeof capabilities.card_payments === "string" ? capabilities.card_payments : null,
      transfers: typeof capabilities.transfers === "string" ? capabilities.transfers : null,
    },
    requirements: requirements
      ? {
          currently_due: stringArray(requirements.currently_due),
          eventually_due: stringArray(requirements.eventually_due),
          past_due: stringArray(requirements.past_due),
          disabled_reason: typeof requirements.disabled_reason === "string"
            ? requirements.disabled_reason
            : null,
        }
      : null,
  };
}

function boundedExternalAccountEvidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SellerAccountAuthorizationChangedError("Stripe returned malformed external-account evidence");
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new SellerAccountAuthorizationChangedError("Stripe returned malformed external-account evidence");
  }
  const accounts = data.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const account = item as Record<string, unknown>;
    if (typeof account.id !== "string") return [];
    return [{
      id: account.id,
      object: typeof account.object === "string" ? account.object : undefined,
      currency: typeof account.currency === "string" ? account.currency : null,
      available_payout_methods: stringArray(account.available_payout_methods),
    }];
  });
  const destination = instantPayoutDestination(accounts, "CAD");
  return {
    hasExternalAccount: data.length > 0,
    instantEligible: Boolean(destination),
    destinationType: destination?.object ?? null,
  };
}

export async function GET() {
  try {
    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return noStoreJson({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const authorization = await authorizeSellerStatusSnapshot(userId);
    if (authorization.kind === "NO_ACCOUNT") {
      return noStoreJson(
        {
          ok: true,
          stripe: {
            hasAccount: false,
            detailsSubmitted: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            fullyEnabled: false,
            instantPayout: { status: "SETUP_REQUIRED", eligible: false, feePaidBy: "TRUEFANTIX" },
            capabilities: null,
            requirements: null,
          },
        },
        { status: 200 },
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
        { status: 503 },
      );
    }

    const snapshot = authorization;
    const account = boundedAccountEvidence(
      await stripe.accounts.retrieve(snapshot.stripeAccountId),
      snapshot.stripeAccountId,
    );
    const externalAccounts: unknown = await stripe.accounts.listExternalAccounts(
      snapshot.stripeAccountId,
      { limit: 100 },
    );
    const external = boundedExternalAccountEvidence(externalAccounts);
    const instantPayoutStatus = instantPayoutStatusLabel(
      external.instantEligible,
      external.hasExternalAccount,
    );

    await persistSellerStatusSnapshot(snapshot, {
      detailsSubmitted: account.detailsSubmitted,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
    });

    return noStoreJson(
      {
        ok: true,
        stripe: {
          hasAccount: true,
          detailsSubmitted: account.detailsSubmitted,
          chargesEnabled: account.chargesEnabled,
          payoutsEnabled: account.payoutsEnabled,
          fullyEnabled: account.fullyEnabled,
          instantPayout: {
            status: instantPayoutStatus,
            eligible: external.instantEligible,
            feePaidBy: "TRUEFANTIX",
            destinationType: external.destinationType,
          },
          // debug (helps us if Stripe still disagrees)
          capabilities: {
            card_payments: account.capabilities.card_payments,
            transfers: account.capabilities.transfers,
          },
          requirements: account.requirements,
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    if (err instanceof ManagedAccountSellerOnboardingError) {
      return noStoreJson(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403 },
      );
    }
    if (err instanceof SellerOnboardingAccountNotFoundError) {
      return noStoreJson({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (err instanceof SellerOnboardingVerificationError) {
      return noStoreJson(
        { ok: false, error: "NOT_VERIFIED", message: "Please verify your email and phone number." },
        { status: 403 },
      );
    }
    console.error("GET /api/sellers/onboarding/status failed:", err);
    const message = err?.message ? String(err.message) : "SERVER_ERROR";
    return noStoreJson({ ok: false, error: "SERVER_ERROR", message }, { status: 500 });
  }
}
