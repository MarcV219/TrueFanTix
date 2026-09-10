const ENABLED_VALUE = "true";
const ISOLATED_ENVIRONMENTS = new Set(["isolated-test", "isolated-preview"]);
const ISOLATED_DATABASE_NAME = /primary[-_].*(test|preview)|(test|preview).*primary[-_]/i;

export type PrimaryPreflightResult =
  | { enabled: false; ready: false; reason: "FEATURE_DISABLED" }
  | { enabled: true; ready: false; reason: string }
  | { enabled: true; ready: true; environmentId: string; databaseName: string };

function databaseIdentity(rawUrl: string): { protocol: string; databaseName: string } | null {
  try {
    const url = new URL(rawUrl);
    return { protocol: url.protocol, databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")) };
  } catch {
    return null;
  }
}

/**
 * Primary ticketing is intentionally fail-closed. Enabling it requires an
 * explicit isolated environment and a dedicated PostgreSQL URL. The URL is
 * never returned or logged by this module.
 */
export function getPrimaryPreflight(env: NodeJS.ProcessEnv = process.env): PrimaryPreflightResult {
  if (env.PRIMARY_TICKETING_ENABLED?.trim().toLowerCase() !== ENABLED_VALUE) {
    return { enabled: false, ready: false, reason: "FEATURE_DISABLED" };
  }

  if (env.NODE_ENV === "production") {
    return { enabled: true, ready: false, reason: "PRODUCTION_FORBIDDEN" };
  }

  const environmentId = env.PRIMARY_TICKETING_ENVIRONMENT_ID?.trim() ?? "";
  if (!ISOLATED_ENVIRONMENTS.has(environmentId)) {
    return { enabled: true, ready: false, reason: "ISOLATED_ENVIRONMENT_REQUIRED" };
  }

  const primaryUrl = env.PRIMARY_TICKETING_DATABASE_URL?.trim() ?? "";
  const applicationUrl = env.DATABASE_URL?.trim() ?? "";
  if (!primaryUrl || !applicationUrl || primaryUrl !== applicationUrl) {
    return { enabled: true, ready: false, reason: "DEDICATED_DATABASE_REQUIRED" };
  }

  const identity = databaseIdentity(primaryUrl);
  if (!identity || !["postgres:", "postgresql:"].includes(identity.protocol)) {
    return { enabled: true, ready: false, reason: "POSTGRESQL_REQUIRED" };
  }
  if (!ISOLATED_DATABASE_NAME.test(identity.databaseName)) {
    return { enabled: true, ready: false, reason: "ISOLATED_DATABASE_NAME_REQUIRED" };
  }

  return { enabled: true, ready: true, environmentId, databaseName: identity.databaseName };
}

export class PrimaryFeatureUnavailableError extends Error {
  readonly code = "PRIMARY_FEATURE_UNAVAILABLE";

  constructor(readonly reason: string) {
    super("Primary ticketing is unavailable.");
    this.name = "PrimaryFeatureUnavailableError";
  }
}

export function requirePrimaryPreflight(env: NodeJS.ProcessEnv = process.env) {
  const result = getPrimaryPreflight(env);
  if (!result.ready) throw new PrimaryFeatureUnavailableError(result.reason);
  return result;
}
