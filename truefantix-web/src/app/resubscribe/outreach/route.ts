export const runtime = "nodejs";

import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { normalizeEmail, outreachOrigin } from "@/lib/outreach";
import { applyRateLimit, getClientIp } from "@/lib/rate-limit";

const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function page(title: string, content: string) {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px"><main style="max-width:560px;margin:48px auto;background:white;border:1px solid #e2e8f0;border-radius:14px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.08)"><h1 style="margin-top:0;font-size:26px">${escapeHtml(title)}</h1>${content}</main></body></html>`, { headers });
}

function emailForm(message = "") {
  return page("Re-subscribe to TrueFanTix outreach", `${message}<p>Enter your email address. We will send you a confirmation link before changing your preferences.</p><form method="post" action="/resubscribe/outreach"><label style="display:block;font-weight:700;margin-bottom:6px">Email address</label><input name="email" type="email" autocomplete="email" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:9px"><button type="submit" style="margin-top:14px;border:0;border-radius:9px;background:#064a93;color:white;font-weight:700;padding:12px 18px;cursor:pointer">Send confirmation email</button></form><p style="font-size:13px;color:#64748b">This restores promotional outreach only. You can unsubscribe again at any time.</p>`);
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return emailForm();
  const request = await prisma.outreachResubscribeRequest.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!request || request.confirmedAt || request.expiresAt <= new Date()) {
    return page("Confirmation link unavailable", '<p>This confirmation link is invalid, expired, or already used.</p><p><a href="/resubscribe/outreach">Request a new confirmation email</a></p>');
  }
  return page("Confirm your re-subscription", `<p>Confirm that you want <strong>${escapeHtml(request.email)}</strong> to receive promotional outreach from TrueFanTix again.</p><form method="post" action="/resubscribe/outreach"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" style="border:0;border-radius:9px;background:#166534;color:white;font-weight:700;padding:12px 18px;cursor:pointer">Yes, re-subscribe me</button></form><p style="font-size:13px;color:#64748b">Opening this page does not change your preference. You must press the confirmation button.</p>`);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") || "");
  if (token) {
    const limited = await applyRateLimit(req, "outreach:resubscribe-confirm");
    if (!limited.ok) return page("Please wait", "<p>Too many attempts. Please try again later.</p>");
    const now = new Date();
    const request = await prisma.outreachResubscribeRequest.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!request || request.confirmedAt || request.expiresAt <= now) {
      return page("Confirmation link unavailable", '<p>This confirmation link is invalid, expired, or already used.</p><p><a href="/resubscribe/outreach">Request a new confirmation email</a></p>');
    }
    const evidence = `Express consent confirmed through the TrueFanTix double opt-in re-subscribe page at ${now.toISOString()}.`;
    await prisma.$transaction([
      prisma.outreachResubscribeRequest.update({ where: { id: request.id }, data: { confirmedAt: now } }),
      prisma.outreachSuppression.deleteMany({ where: { normalizedEmail: request.normalizedEmail } }),
      prisma.outreachContact.updateMany({ where: { normalizedEmail: request.normalizedEmail }, data: { unsubscribedAt: null, consentBasis: "EXPRESS_CONSENT", consentEvidence: evidence } }),
    ]);
    return page("You are re-subscribed", "<p>Your express consent has been recorded and your email address can receive relevant TrueFanTix outreach again.</p><p>You may unsubscribe again at any time using the link in any outreach email.</p>");
  }

  const limited = await applyRateLimit(req, "outreach:resubscribe-request");
  if (!limited.ok) return page("Please wait", "<p>Too many requests. Please try again later.</p>");
  const email = normalizeEmail(String(form.get("email") || ""));
  if (!validEmail(email)) return emailForm('<p style="color:#991b1b">Enter a valid email address.</p>');

  const suppression = await prisma.outreachSuppression.findUnique({ where: { normalizedEmail: email }, select: { id: true } });
  if (suppression) {
    const token = randomBytes(32).toString("base64url");
    await prisma.outreachResubscribeRequest.create({ data: { email, normalizedEmail: email, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), requestIp: getClientIp(req).slice(0, 100) } });
    const confirmationUrl = `${outreachOrigin()}/resubscribe/outreach?token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: email,
      subject: "Confirm your TrueFanTix re-subscription",
      text: `You asked to receive TrueFanTix outreach again. Confirm your request here:\n\n${confirmationUrl}\n\nThis link expires in 24 hours. If you did not request this, ignore this email and you will remain unsubscribed.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Confirm your TrueFanTix re-subscription</h2><p>You asked to receive relevant TrueFanTix outreach again.</p><p><a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;background:#064a93;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Review and confirm</a></p><p>This link expires in 24 hours. If you did not request this, ignore this email and you will remain unsubscribed.</p></div>`,
    });
  }
  return page("Check your email", "<p>If that address is currently unsubscribed, we sent it a confirmation link. The address remains unsubscribed until the confirmation button is pressed.</p>");
}
