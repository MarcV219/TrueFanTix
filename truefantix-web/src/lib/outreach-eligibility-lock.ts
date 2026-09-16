import type { Prisma } from "@prisma/client";

/**
 * Serializes every eligibility mutation for one normalized outreach address.
 * Call this before locking or mutating campaign, recipient, contact, suppression,
 * or resubscription rows in the same transaction.
 */
export async function lockOutreachEligibility(
  tx: Prisma.TransactionClient,
  normalizedEmail: string,
) {
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`truefantix:outreach:${normalizedEmail}`}, 0)
    )::text AS "locked"
  `;
}
