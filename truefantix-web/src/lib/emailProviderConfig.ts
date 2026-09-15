export type EmailProvider = "RESEND" | "SENDGRID" | "CONSOLE";
type EmailProviderEnvironment = {
  RESEND_API_KEY?: string;
  SENDGRID_API_KEY?: string;
};

function processEmailProviderEnvironment(): EmailProviderEnvironment {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  };
}

export function cleanEmailProviderCredential(value: string | undefined) {
  return value?.trim().replace(/^['"]+|['"]+$/g, "").trim();
}

export function configuredEmailProvider(
  env: EmailProviderEnvironment = processEmailProviderEnvironment(),
): EmailProvider | null {
  if (cleanEmailProviderCredential(env.RESEND_API_KEY)) return "RESEND";
  if (cleanEmailProviderCredential(env.SENDGRID_API_KEY)) return "SENDGRID";
  return null;
}

export function emailProviderIsConfigured(
  provider: EmailProvider,
  env: EmailProviderEnvironment = processEmailProviderEnvironment(),
) {
  if (provider === "RESEND") return Boolean(cleanEmailProviderCredential(env.RESEND_API_KEY));
  if (provider === "SENDGRID") return Boolean(cleanEmailProviderCredential(env.SENDGRID_API_KEY));
  return false;
}

export function emailProviderEvidence(
  result: { provider: EmailProvider },
): EmailProvider {
  if (result.provider === "RESEND" || result.provider === "SENDGRID") {
    return result.provider;
  }
  return "CONSOLE";
}
