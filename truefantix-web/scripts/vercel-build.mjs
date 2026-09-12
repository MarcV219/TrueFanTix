import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ISOLATED_DATABASE_NAME = /primary[-_].*(test|preview)|(test|preview).*primary[-_]/i;

export function shouldMigrateIsolatedStaging(env) {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "staging") return false;
  const primaryUrl = env.PRIMARY_TICKETING_DATABASE_URL?.trim() ?? "";
  const applicationUrl = env.DATABASE_URL?.trim() ?? "";
  let database;
  try {
    database = new URL(primaryUrl);
  } catch {
    throw new Error("Staging migration refused: dedicated database URL is invalid.");
  }
  if (
    env.PRIMARY_TICKETING_ENABLED?.trim().toLowerCase() !== "true"
    || env.PRIMARY_TICKETING_ENVIRONMENT_ID !== "isolated-preview"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID !== "isolated-preview"
    || env.PRIMARY_STAGING_CONSOLE_ENABLED?.trim().toLowerCase() !== "true"
    || !primaryUrl
    || primaryUrl !== applicationUrl
    || !["postgres:", "postgresql:"].includes(database.protocol)
    || !ISOLATED_DATABASE_NAME.test(decodeURIComponent(database.pathname.replace(/^\//, "")))
  ) {
    throw new Error("Staging migration refused: isolated-preview boundary is incomplete.");
  }
  return true;
}

function run(command, args) {
  const result = spawnSync(command, args, { env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  if (shouldMigrateIsolatedStaging(process.env)) {
    console.log("Applying migrations to the verified isolated staging database.");
    run("npx", ["prisma", "migrate", "deploy"]);
  }
  run("npm", ["run", "build"]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
