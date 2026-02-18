export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 }
    );
  }

  const userId = await getUserIdFromSessionCookie();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "NOT_AUTHENTICATED", message: "Please log in." },
      { status: 401 }
    );
  }

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
