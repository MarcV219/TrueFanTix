export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseSellerIdFromUrl(req: Request): string {
  // /api/sellers/<id>/access-tokens (legacy path: /credits)
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const sellersIndex = parts.indexOf("sellers");
  if (sellersIndex !== -1 && parts.length > sellersIndex + 1) {
    return normalizeId(parts[sellersIndex + 1]);
  }
  return "";
}

async function getSellerId(req: Request, ctx: Ctx): Promise<string> {
  const fromUrl = parseSellerIdFromUrl(req);
  if (fromUrl) return fromUrl;

  const p: any = ctx?.params;
  if (!p) return "";

  const resolved = typeof p?.then === "function" ? await p : p;
  return normalizeId(resolved?.id);
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const sellerId = await getSellerId(req, ctx);
    const url = new URL(req.url);

    if (!sellerId) {
      return NextResponse.json(
        { ok: false, error: "Missing seller id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 200);
    const cursor = url.searchParams.get("cursor") || undefined;

    // Optional filters
    const type = url.searchParams.get("type") || undefined;   // EARNED/SPENT/etc
    const source = url.searchParams.get("source") || undefined; // SOLD_OUT_PURCHASE/ADMIN/REFUND

    const where: any = { sellerId };
    if (type) where.type = type;
    if (source) where.source = source;

    const rows = await prisma.creditTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        sellerId: true,
        type: true,
        source: true,
        amountCredits: true,
        balanceAfterCredits: true,
        note: true,
        referenceType: true,
        referenceId: true,
        ticketId: true,
        orderId: true,
        payoutId: true,
        createdAt: true,
      },
    });

    const hasNext = rows.length > take;
    const page = hasNext ? rows.slice(0, take) : rows;
    const nextCursor = hasNext ? page[page.length - 1]?.id ?? null : null;

    return NextResponse.json({
      ok: true,
      sellerId,
      take,
      nextCursor,
      accessTokens: page,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Access token fetch failed", details: message },
      { status: 500 }
    );
  }
}
