import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailFromUnsubscribeToken } from "@/lib/outreach";

const textHeaders = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

function tokenFrom(req: Request) {
  return new URL(req.url).searchParams.get("token") || "";
}

export async function GET(req: Request) {
  const token = tokenFrom(req);
  const email = emailFromUnsubscribeToken(token);
  if (!email) return new NextResponse("This unsubscribe link is invalid.", { status: 400, headers: textHeaders });

  // GET deliberately does not change state. Security scanners routinely visit links
  // in delivered email; requiring POST prevents those visits from opting people out.
  const action = `/unsubscribe/outreach?token=${encodeURIComponent(token)}`;
  return new NextResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe from TrueFanTix outreach</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px">
  <main style="max-width:560px;margin:48px auto;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.08)">
    <h1 style="margin-top:0;font-size:26px">Stop TrueFanTix outreach emails?</h1>
    <p>Confirm below and we will immediately add <strong>${email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</strong> to our global do-not-contact list.</p>
    <form method="post" action="${action}"><button type="submit" style="border:0;border-radius:9px;background:#991b1b;color:white;font-weight:700;padding:12px 18px;cursor:pointer">Unsubscribe me</button></form>
    <p style="font-size:13px;color:#64748b;margin-bottom:0">This applies to promotional outreach from TrueFanTix. Transactional messages about your account or orders are unaffected.</p>
  </main>
</body></html>`, { headers: htmlHeaders });
}

export async function POST(req: Request) {
  const email = emailFromUnsubscribeToken(tokenFrom(req));
  if (!email) return new NextResponse("This unsubscribe link is invalid.", { status: 400, headers: textHeaders });
  const unsubscribedAt = new Date();
  await prisma.$transaction([
    prisma.outreachSuppression.upsert({ where: { normalizedEmail: email }, create: { normalizedEmail: email, email, reason: "UNSUBSCRIBED", source: "LINK" }, update: { reason: "UNSUBSCRIBED", source: "LINK" } }),
    prisma.outreachContact.updateMany({ where: { normalizedEmail: email }, data: { unsubscribedAt } }),
    prisma.outreachRecipient.updateMany({ where: { emailSnapshot: { equals: email, mode: "insensitive" }, status: "PENDING" }, data: { status: "SUPPRESSED", error: "UNSUBSCRIBED" } }),
  ]);
  return new NextResponse("You have been unsubscribed from TrueFanTix outreach emails. You will not receive further promotional outreach at this address.", { headers: textHeaders });
}
