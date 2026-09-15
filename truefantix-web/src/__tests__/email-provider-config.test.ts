/** @jest-environment node */

import {
  cleanEmailProviderCredential,
  configuredEmailProvider,
  emailProviderEvidence,
  emailProviderIsConfigured,
} from "@/lib/emailProviderConfig";

describe("email provider credential normalization", () => {
  it.each([
    undefined,
    "",
    "   ",
    "''",
    '\"\"',
    "' '",
    '\" \"',
    "''''",
    `'\"\"'`,
  ])("treats %p as absent", (credential) => {
    expect(cleanEmailProviderCredential(credential)).toBeFalsy();
    const env = { RESEND_API_KEY: credential };
    expect(emailProviderIsConfigured("RESEND", env)).toBe(false);
  });

  it("selects the first usable credential after applying sender normalization", () => {
    const env = {
      RESEND_API_KEY: "  ' '  ",
      SENDGRID_API_KEY: "  'synthetic-sendgrid-key'  ",
    };

    expect(configuredEmailProvider(env)).toBe("SENDGRID");
    expect(emailProviderIsConfigured("RESEND", env)).toBe(false);
    expect(emailProviderIsConfigured("SENDGRID", env)).toBe(true);
    expect(cleanEmailProviderCredential(env.SENDGRID_API_KEY)).toBe("synthetic-sendgrid-key");
  });

  it("records returned provider evidence ahead of current configuration", () => {
    const env = {
      RESEND_API_KEY: "synthetic-resend-key",
      SENDGRID_API_KEY: "synthetic-sendgrid-key",
    };

    expect(emailProviderEvidence({ provider: "SENDGRID" }, env)).toBe("SENDGRID");
    expect(emailProviderEvidence({}, env)).toBe("RESEND");
    expect(emailProviderEvidence({}, { RESEND_API_KEY: "  '\"\"'  " })).toBe("CONSOLE");
  });
});
