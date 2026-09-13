import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

export class ManagedAccountAdminOperationError extends Error {}

export type AdminOperationAccessErrorCode =
  | "NOT_AUTHENTICATED"
  | "BANNED"
  | "NOT_VERIFIED"
  | "FORBIDDEN";

export class AdminOperationAccessChangedError extends Error {
  constructor(readonly code: AdminOperationAccessErrorCode) {
    super(code);
  }
}

export async function runOrdinaryAdminOperation<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Keep privileged mutation behind the current identity lock so an
        // access-token persona restoration cannot reuse a stale admin guard.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            email: true,
            phone: true,
            termsVersion: true,
            privacyVersion: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            isBanned: true,
            role: true,
          },
        });

        if (!current) throw new AdminOperationAccessChangedError("NOT_AUTHENTICATED");
        if (isPrimaryStagingManagedUser(current)) {
          throw new ManagedAccountAdminOperationError();
        }
        if (current.isBanned) throw new AdminOperationAccessChangedError("BANNED");
        if (!current.emailVerifiedAt || !current.phoneVerifiedAt) {
          throw new AdminOperationAccessChangedError("NOT_VERIFIED");
        }
        if (current.role !== "ADMIN") {
          throw new AdminOperationAccessChangedError("FORBIDDEN");
        }

        return operation(tx);
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountAdminOperationError) throw error;

    // Only translate an abort when restoration has now installed a complete
    // managed marker. Unrelated admin failures retain their existing contract.
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
      },
    });
    if (current && isPrimaryStagingManagedUser(current)) {
      throw new ManagedAccountAdminOperationError();
    }
    throw error;
  }
}
