import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailFromUnsubscribeToken } from "@/lib/outreach";

async function suppress(req: Request) {
  const url = new URL(req.url); const email = emailFromUnsubscribeToken(url.searchParams.get("token") || "");
  if (!email) return new NextResponse("This unsubscribe link is invalid.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  await prisma.$transaction([
    prisma.outreachSuppression.upsert({ where: { normalizedEmail: email }, create: { normalizedEmail: email, email, reason: "UNSUBSCRIBED", source: "LINK" }, update: { reason: "UNSUBSCRIBED", source: "LINK" } }),
    prisma.outreachContact.updateMany({ where: { normalizedEmail: email }, data: { unsubscribedAt: new Date() } }),
  ]);
  return new NextResponse("You have been unsubscribed from TrueFanTix outreach emails. You will not receive further promotional outreach at this address.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
export const GET = suppress;
export const POST = suppress;
