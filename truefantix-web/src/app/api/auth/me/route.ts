export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie, clearSessionCookie } from "@/lib/auth/session";

function toIsoOrNull(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function noStoreJson(body: any, init?: ResponseInit) {
  const res = NextResponse.json(body, init);
  // Bank-grade: never cache session introspection responses
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function withTimeout<T>(label: string, ms: number, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT:${label}:${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export async function GET() {
  const rid = Math.random().toString(16).slice(2, 8);
  const started = Date.now();

  try {
    console.log(`[ME ${rid}] start`);

    // 1) Session cookie -> userId
    console.log(`[ME ${rid}] reading session cookie`);
    const userId = await withTimeout("getUserIdFromSessionCookie", 2500, getUserIdFromSessionCookie());
    console.log(`[ME ${rid}] session userId=${userId ? "yes" : "no"}`);

    // Logged out / no valid session -> 200 with user:null
    if (!userId) {
      console.log(`[ME ${rid}] no userId -> clearing cookie (best effort)`);
      await withTimeout(
        "clearSessionCookie",
        1500,
        clearSessionCookie().catch(() => undefined as any)
      );
      console.log(`[ME ${rid}] done -> logged out`);
      return noStoreJson({ ok: true, user: null }, { status: 200 });
    }

    // 2) DB lookup
    console.log(`[ME ${rid}] prisma.user.findUnique`);
    const user = await withTimeout(
      "prisma.user.findUnique",
      3500,
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          seller: { select: { status: true } },
        },
      })
    );
    console.log(`[ME ${rid}] db user=${user ? "found" : "missing"}`);

    // Session cookie exists but user not found -> treat as logged out (cookie likely stale)
    if (!user) {
      console.log(`[ME ${rid}] stale session -> clearing cookie (best effort)`);
      await withTimeout(
        "clearSessionCookie",
        1500,
        clearSessionCookie().catch(() => undefined as any)
      );
      return noStoreJson({ ok: true, user: null }, { status: 200 });
    }

    // Banned remains a true authorization failure
    if (user.isBanned) {
      console.log(`[ME ${rid}] banned -> 403`);
      return noStoreJson(
        { ok: false, error: "BANNED", message: "This account is restricted." },
        { status: 403 }
      );
    }

    const isVerified = !!user.emailVerifiedAt && !!user.phoneVerifiedAt;
    const isSellerApproved = isVerified && user.canSell && user.seller?.status === "APPROVED";
    const isAdmin = isVerified && user.role === "ADMIN";

    const ms = Date.now() - started;
    console.log(`[ME ${rid}] success in ${ms}ms`);

    return noStoreJson(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName,

          // ✅ Add sellerId so account screens can filter "my listings"
          sellerId: user.sellerId ?? null,

          // IMPORTANT: return strings for client safety/consistency
          emailVerifiedAt: toIsoOrNull(user.emailVerifiedAt),
          phoneVerifiedAt: toIsoOrNull(user.phoneVerifiedAt),

          country: user.country,
          region: user.region,
          city: user.city,
          postalCode: user.postalCode,
          streetAddress1: user.streetAddress1,
          streetAddress2: user.streetAddress2,

          canBuy: user.canBuy,
          canComment: user.canComment,
          canSell: user.canSell,
          role: user.role,
          sellerStatus: user.seller?.status ?? null,

          isBanned: user.isBanned,

          flags: {
            isVerified,
            isSellerApproved,
            isAdmin,
          },
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : String(err);

    // If something hangs, return a clear response instead of spinning forever
    if (msg.startsWith("TIMEOUT:")) {
      console.error(`[ME ${rid}] ${msg}`);
      return noStoreJson({ ok: false, error: "TIMEOUT", message: msg }, { status: 504 });
    }

    console.error(`[ME ${rid}] failed:`, err);
    return noStoreJson({ ok: false, error: "SERVER_ERROR", message: msg }, { status: 500 });
  }
}
