export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { requireDebugAccess } from "@/lib/security/debug-access";

export async function POST(req: Request) {
  const debugGate = requireDebugAccess(req);
  if (!debugGate.ok) return debugGate.res;
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 }
    );
  }

  const gate = await requireUser(req);
  if (!gate.ok) return gate.res;
  const userId = gate.user.id;

  const now = new Date();

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
    },
    select: {
      id: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  });

  return NextResponse.json({ ok: true, user }, { status: 200 });
}
