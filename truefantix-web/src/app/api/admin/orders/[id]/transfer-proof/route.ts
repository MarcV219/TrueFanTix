export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

function orderIdFromUrl(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  return ordersIndex >= 0 ? decodeURIComponent(parts[ordersIndex + 1] || "").trim() : "";
}

function safeFileName(value: unknown) {
  const fileName = String(value || "transfer-proof.pdf")
    .replace(/[\r\n"]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  return fileName || "transfer-proof.pdf";
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const orderId = orderIdFromUrl(req);
  if (!orderId) {
    return Response.json({ ok: false, error: "Missing order id" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { transferProofData: true },
  });
  if (!order) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  let storedProof: { proofUpload?: unknown; fileName?: unknown } | null = null;
  try {
    storedProof = order.transferProofData ? JSON.parse(order.transferProofData) : null;
  } catch {
    storedProof = null;
  }

  const dataUrl = typeof storedProof?.proofUpload === "string" ? storedProof.proofUpload : "";
  const match = /^data:(application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    return Response.json({ ok: false, error: "PDF transfer proof is unavailable" }, { status: 404 });
  }

  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.subarray(0, 4).toString("ascii") !== "%PDF") {
    return Response.json({ ok: false, error: "Stored transfer proof is not a valid PDF" }, { status: 422 });
  }

  const fileName = safeFileName(storedProof?.fileName);
  return new Response(Uint8Array.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
