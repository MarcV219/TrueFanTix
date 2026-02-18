export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function parseIdFromUrl(req: Request): string {
  // /api/sellers/<id>/purchases
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const sellersIndex = parts.indexOf("sellers");
  if (sellersIndex !== -1 && parts.length > sellersIndex + 1) {
    return decodeURIComponent(parts[sellersIndex + 1] ?? "").trim();
  }
  return "";
}

async function getId(req: Request, ctx: Ctx): Promise<string> {
  const fromUrl = parseIdFromUrl(req);
  if (fromUrl) return fromUrl;

  const p: any = ctx?.params;
  if (!p) return "";
  const resolved = typeof p?.then === "function" ? await p : p;
  return decodeURIComponent(String(resolved?.id ?? "")).trim();
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const buyerSellerId = await getId(req, ctx);
    if (!buyerSellerId) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const purchases = await prisma.order.findMany({
      where: { buyerSellerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        ticket: { include: { event: true } },
        seller: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      buyerSellerId,
      purchases,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Purchases fetch failed", details: message },
      { status: 500 }
    );
  }
}
