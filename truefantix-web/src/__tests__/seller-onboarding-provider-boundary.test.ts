/** @jest-environment node */

import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  SellerAccountMissingError,
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
import { POST as startOnboarding } from "@/app/api/sellers/onboarding/start/route";
import { POST as createLoginLink } from "@/app/api/sellers/onboarding/login/route";

const mockAccountCreate = jest.fn();
const mockAccountLinkCreate = jest.fn();
const mockLoginLinkCreate = jest.fn();
const mockAccountUpdate = jest.fn();

jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  accounts: {
    create: mockAccountCreate,
    update: mockAccountUpdate,
    createLoginLink: mockLoginLinkCreate,
  },
  accountLinks: { create: mockAccountLinkCreate },
})));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ applyRateLimit: jest.fn() }));

jest.mock("@/lib/sellers/ordinary-onboarding", () => {
  class ManagedAccountSellerOnboardingError extends Error {}
  class SellerOnboardingVerificationError extends Error {}
  class SellerAccountAuthorizationChangedError extends Error {}
  class SellerAccountReconciliationRequiredError extends Error {}
  class SellerAccountMissingError extends Error {}
  return {
    ManagedAccountSellerOnboardingError,
    SellerOnboardingVerificationError,
    SellerAccountAuthorizationChangedError,
    SellerAccountReconciliationRequiredError,
    SellerAccountMissingError,
    authorizeSellerAccountStart: jest.fn(),
    authorizeSellerLinkSnapshot: jest.fn(),
    canonicalSellerOnboardingOrigin: jest.fn(),
    claimLegacySellerAccountCommand: jest.fn(),
    finalizeLegacySellerAccountCommand: jest.fn(),
    markSellerAccountReconciliationRequired: jest.fn(),
    resolveSellerAccountCommand: jest.fn(),
    sellerAccountCreateParams: jest.fn(),
    sellerAccountProviderEvidence: jest.fn(),
  };
});

const mockedGuard = requireVerifiedUser as jest.MockedFunction<typeof requireVerifiedUser>;
const mockedRateLimit = applyRateLimit as jest.MockedFunction<typeof applyRateLimit>;
const mockedAuthorizeStart = authorizeSellerAccountStart as jest.MockedFunction<typeof authorizeSellerAccountStart>;
const mockedAuthorizeLink = authorizeSellerLinkSnapshot as jest.MockedFunction<typeof authorizeSellerLinkSnapshot>;
const mockedOrigin = canonicalSellerOnboardingOrigin as jest.MockedFunction<typeof canonicalSellerOnboardingOrigin>;
const mockedClaim = claimLegacySellerAccountCommand as jest.MockedFunction<typeof claimLegacySellerAccountCommand>;
const mockedFinalize = finalizeLegacySellerAccountCommand as jest.MockedFunction<typeof finalizeLegacySellerAccountCommand>;
const mockedReconcile = markSellerAccountReconciliationRequired as jest.MockedFunction<typeof markSellerAccountReconciliationRequired>;
const mockedResolve = resolveSellerAccountCommand as jest.MockedFunction<typeof resolveSellerAccountCommand>;
const mockedCreateParams = sellerAccountCreateParams as jest.MockedFunction<typeof sellerAccountCreateParams>;
const mockedEvidence = sellerAccountProviderEvidence as jest.MockedFunction<typeof sellerAccountProviderEvidence>;

const command = {
  id: "command-1",
  idempotencyKey: "truefantix:seller-account:seller-1",
  status: "NOT_SENT",
} as any;
const claimed = { ...command, status: "ATTEMPTING" } as any;
const evidence = {
  id: "acct_synthetic",
  type: "express",
  country: "CA",
  capabilities: { transfers: "pending" },
  metadata: { userId: "user-1", sellerId: "seller-1", platform: "TrueFanTix" },
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
};

function request(path: string) {
  return new Request(`https://hostile.example${path}`, {
    method: "POST",
    headers: {
      Host: "hostile.example",
      Origin: "https://hostile.example",
      "X-Forwarded-Host": "forwarded-hostile.example",
      "X-Forwarded-Proto": "http",
    },
  });
}

describe("seller onboarding provider boundaries", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_synthetic" };
    mockedGuard.mockResolvedValue({ ok: true, user: { id: "user-1" } } as never);
    mockedRateLimit.mockResolvedValue({ ok: true } as never);
    mockedOrigin.mockReturnValue("https://seller-onboarding.test.invalid");
    mockedAuthorizeStart.mockResolvedValue({ kind: "COMMAND", command } as never);
    mockedClaim.mockResolvedValue(claimed);
    mockedCreateParams.mockReturnValue({ frozen: "provider-input" } as never);
    mockAccountCreate.mockResolvedValue({ id: evidence.id });
    mockedEvidence.mockReturnValue(evidence);
    mockedFinalize.mockResolvedValue({
      userId: "user-1", sellerId: "seller-1", stripeAccountId: evidence.id,
    });
    mockedAuthorizeLink.mockResolvedValue({
      userId: "user-1",
      sellerId: "seller-1",
      stripeAccountId: evidence.id,
      linkKind: "ONBOARDING",
      refreshUrl: "https://seller-onboarding.test.invalid/account?stripe=refresh",
      returnUrl: "https://seller-onboarding.test.invalid/account?stripe=return",
    });
    mockAccountLinkCreate.mockResolvedValue({ url: "https://provider.example/onboard" });
    mockLoginLinkCreate.mockResolvedValue({ url: "https://provider.example/login" });
    mockedReconcile.mockResolvedValue({ count: 1 } as never);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("dispatches one frozen account command, finalizes it, then creates a post-commit canonical link", async () => {
    let snapshotResolved = false;
    mockedAuthorizeLink.mockImplementation(async () => {
      snapshotResolved = true;
      return {
        userId: "user-1", sellerId: "seller-1", stripeAccountId: evidence.id,
        linkKind: "ONBOARDING", refreshUrl: "https://seller-onboarding.test.invalid/account?stripe=refresh",
        returnUrl: "https://seller-onboarding.test.invalid/account?stripe=return",
      };
    });
    mockAccountLinkCreate.mockImplementation(async () => {
      expect(snapshotResolved).toBe(true);
      return { url: "https://provider.example/onboard" };
    });

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(200);
    expect(mockAccountCreate).toHaveBeenCalledWith(
      { frozen: "provider-input" },
      { idempotencyKey: command.idempotencyKey },
    );
    expect(mockedFinalize).toHaveBeenCalledWith(command.id, evidence);
    expect(mockedAuthorizeLink).toHaveBeenCalledWith(
      "user-1",
      "ONBOARDING",
      "https://seller-onboarding.test.invalid",
    );
    expect(mockAccountLinkCreate).toHaveBeenCalledWith({
      account: evidence.id,
      refresh_url: "https://seller-onboarding.test.invalid/account?stripe=refresh",
      return_url: "https://seller-onboarding.test.invalid/account?stripe=return",
      type: "account_onboarding",
    });
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });

  it("uses a current committed snapshot for an existing account without create or update", async () => {
    mockedAuthorizeStart.mockResolvedValue({
      kind: "ACCOUNT_READY", sellerId: "seller-1", stripeAccountId: "acct_existing",
    });
    mockedAuthorizeLink.mockResolvedValue({
      userId: "user-1", sellerId: "seller-1", stripeAccountId: "acct_existing",
      linkKind: "ONBOARDING", refreshUrl: "https://seller-onboarding.test.invalid/account?stripe=refresh",
      returnUrl: "https://seller-onboarding.test.invalid/account?stripe=return",
    });

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(200);
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockAccountUpdate).not.toHaveBeenCalled();
    expect(mockAccountLinkCreate).toHaveBeenCalledWith(expect.objectContaining({ account: "acct_existing" }));
  });

  it("turns an ambiguous account-create outcome into non-retryable reconciliation", async () => {
    mockAccountCreate.mockRejectedValue(new Error("timeout"));

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "SELLER_ACCOUNT_RECONCILIATION_REQUIRED",
      retrySafe: false,
    });
    expect(mockedReconcile).toHaveBeenCalledWith(command.id, "PROVIDER_OUTCOME_UNKNOWN");
    expect(mockAccountLinkCreate).not.toHaveBeenCalled();
  });

  it("does no provider work after authorization serialization failure", async () => {
    mockedAuthorizeStart.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(500);
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockAccountLinkCreate).not.toHaveBeenCalled();
  });

  it("never reaches an onboarding link after account-binding revalidation fails", async () => {
    mockedAuthorizeStart.mockResolvedValue({
      kind: "ACCOUNT_READY", sellerId: "seller-1", stripeAccountId: "acct_old",
    });
    mockedAuthorizeLink.mockRejectedValue(new SellerAccountMissingError());

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(409);
    expect(mockAccountLinkCreate).not.toHaveBeenCalled();
  });

  it("does no onboarding-link provider work when the committed snapshot wrapper rejects with P2034", async () => {
    mockedAuthorizeStart.mockResolvedValue({
      kind: "ACCOUNT_READY", sellerId: "seller-1", stripeAccountId: "acct_old",
    });
    mockedAuthorizeLink.mockRejectedValue(
      Object.assign(new Error("post-callback serialization failure"), { code: "P2034" }),
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(500);
    expect(mockAccountLinkCreate).not.toHaveBeenCalled();
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });

  it("does no onboarding-link provider work after an explicit snapshot callback rollback", async () => {
    mockedAuthorizeStart.mockResolvedValue({
      kind: "ACCOUNT_READY", sellerId: "seller-1", stripeAccountId: "acct_old",
    });
    mockedAuthorizeLink.mockRejectedValue(new Error("synthetic snapshot callback rollback"));
    const diagnostic = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(500);
    expect(mockAccountLinkCreate).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(
      "POST /api/sellers/onboarding/start failed:",
      expect.objectContaining({ message: "synthetic snapshot callback rollback" }),
    );
  });

  it.each([
    ["P2034 serialization abort", Object.assign(new Error("serialization failure"), { code: "P2034" })],
    ["callback rollback", new Error("force authorization callback rollback")],
  ])("does not create an onboarding link after committed-account snapshot %s", async (_label, failure) => {
    mockedAuthorizeStart.mockResolvedValue({
      kind: "ACCOUNT_READY", sellerId: "seller-1", stripeAccountId: "acct_ready",
    });
    mockedAuthorizeLink.mockRejectedValue(failure);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(500);
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockAccountUpdate).not.toHaveBeenCalled();
    expect(mockAccountLinkCreate).not.toHaveBeenCalled();
  });

  it("creates a login link only after its current account snapshot resolves", async () => {
    let snapshotResolved = false;
    mockedAuthorizeLink.mockImplementation(async () => {
      snapshotResolved = true;
      return {
        userId: "user-1", sellerId: "seller-1", stripeAccountId: "acct_login",
        linkKind: "LOGIN", refreshUrl: null, returnUrl: null,
      };
    });
    mockLoginLinkCreate.mockImplementation(async () => {
      expect(snapshotResolved).toBe(true);
      return { url: "https://provider.example/login" };
    });

    const response = await createLoginLink(request("/api/sellers/onboarding/login"));

    expect(response.status).toBe(200);
    expect(mockedAuthorizeLink).toHaveBeenCalledWith("user-1", "LOGIN");
    expect(mockLoginLinkCreate).toHaveBeenCalledWith("acct_login");
  });

  it("does not call the login provider after a failed or missing snapshot", async () => {
    mockedAuthorizeLink.mockRejectedValue(new SellerAccountMissingError());

    const response = await createLoginLink(request("/api/sellers/onboarding/login"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "STRIPE_ACCOUNT_MISSING" });
    expect(mockLoginLinkCreate).not.toHaveBeenCalled();
  });

  it("does no login-link provider work after post-callback P2034 retry exhaustion", async () => {
    mockedAuthorizeLink.mockRejectedValue(
      Object.assign(new Error("post-callback serialization failure"), { code: "P2034" }),
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await createLoginLink(request("/api/sellers/onboarding/login"));

    expect(response.status).toBe(500);
    expect(mockLoginLinkCreate).not.toHaveBeenCalled();
  });

  it("uses only the configured canonical origin and performs no local work after an ephemeral link call", async () => {
    mockedAuthorizeStart.mockResolvedValue({
      kind: "ACCOUNT_READY", sellerId: "seller-1", stripeAccountId: "acct_exact_authorized",
    });
    mockedAuthorizeLink.mockResolvedValue({
      userId: "user-1",
      sellerId: "seller-1",
      stripeAccountId: "acct_exact_authorized",
      linkKind: "ONBOARDING",
      refreshUrl: "https://seller-onboarding.test.invalid/account?stripe=refresh",
      returnUrl: "https://seller-onboarding.test.invalid/account?stripe=return",
    });
    mockAccountLinkCreate.mockImplementation(async (input) => {
      expect(input).toEqual({
        account: "acct_exact_authorized",
        refresh_url: "https://seller-onboarding.test.invalid/account?stripe=refresh",
        return_url: "https://seller-onboarding.test.invalid/account?stripe=return",
        type: "account_onboarding",
      });
      return { url: "https://provider.example/onboard" };
    });

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(200);
    expect(mockedOrigin).toHaveBeenCalledWith();
    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockedFinalize).not.toHaveBeenCalled();
    expect(mockedReconcile).not.toHaveBeenCalled();
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["P2034 serialization abort", Object.assign(new Error("serialization failure"), { code: "P2034" })],
    ["callback rollback", new Error("force authorization callback rollback")],
  ])("does not create a login link after snapshot %s", async (_label, failure) => {
    mockedAuthorizeLink.mockRejectedValue(failure);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await createLoginLink(request("/api/sellers/onboarding/login"));

    expect(response.status).toBe(500);
    expect(mockLoginLinkCreate).not.toHaveBeenCalled();
  });

  it("replays durable success without another account create", async () => {
    mockedClaim.mockResolvedValue(null);
    mockedResolve.mockResolvedValue({ ...claimed, status: "SUCCEEDED", providerAccountId: evidence.id } as never);

    const response = await startOnboarding(request("/api/sellers/onboarding/start"));

    expect(response.status).toBe(200);
    expect(mockedResolve).toHaveBeenCalledWith(command.id);
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockAccountLinkCreate).toHaveBeenCalledTimes(1);
  });
});
