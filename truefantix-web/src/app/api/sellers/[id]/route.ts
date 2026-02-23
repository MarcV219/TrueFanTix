export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function getIdFromPath(req: Request) {
  const pathname = new URL(req.url).pathname; // /api/sellers/<id>
  const parts = pathname.split("/").filter(Boolean);
  const sellersIndex = parts.indexOf("sellers");
  if (sellersIndex !== -1 && parts.length > sellersIndex + 1) {
    return normalizeId(parts[sellersIndex + 1]);
  }
  return "";
}

export async function GET(req: Request) {
  try {
    const id = getIdFromPath(req);

    if (!id) {
      return NextResponse.json(
        { error: "Missing seller id", debug: { url: req.url, pathname: new URL(req.url).pathname } },
        { status: 400 }
      );
    }

    const seller = await prisma.seller.findUnique({
      where: { id },
      include: {
        badges: true,
        tickets: true,
        creditTransactions: { orderBy: { createdAt: "desc" }, take: 25 },
        orders: { orderBy: { createdAt: "desc" }, take: 25 },
      },
    });

    if (!seller) {
      return NextResponse.json(
        { error: "Seller not found", debug: { id } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...seller,
      badges: seller.badges.map((b: any) => b.name),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Seller lookup failed", details: message }, { status: 500 });
  }
}
