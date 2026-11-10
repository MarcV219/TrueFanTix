export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

function eventIdFromRequest(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("events");
  return index >= 0 && parts[index + 1] ? decodeURIComponent(parts[index + 1]) : "";
}

function optionalText(value: unknown, max: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`Fields must be ${max} characters or less.`);
  return normalized;
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const id = eventIdFromRequest(req);
  if (!id) return NextResponse.json({ ok: false, error: "MISSING_EVENT_ID" }, { status: 400 });

  try {
    const body = await req.json();
    const description = optionalText(body.description, 2000);
    const organizerName = optionalText(body.organizerName, 200);
    const performerName = optionalText(body.performerName, 200);
    const endDate = optionalText(body.endDate, 100);
    const seoSourceUrl = optionalText(body.seoSourceUrl, 1000);

    if (!seoSourceUrl) {
      return NextResponse.json({ ok: false, error: "SOURCE_REQUIRED", message: "Add the official source URL used to verify these event facts." }, { status: 400 });
    }
    let source: URL;
    try {
      source = new URL(seoSourceUrl);
    } catch {
      return NextResponse.json({ ok: false, error: "INVALID_SOURCE", message: "Enter a valid official source URL." }, { status: 400 });
    }
    if (source.protocol !== "https:") {
      return NextResponse.json({ ok: false, error: "INVALID_SOURCE", message: "The official source URL must use HTTPS." }, { status: 400 });
    }

    const event = await prisma.event.findUnique({ where: { id }, select: { date: true } });
    if (!event) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (endDate) {
      const start = new Date(String(event.date || ""));
      const end = new Date(endDate);
      if (Number.isNaN(end.getTime()) || (!Number.isNaN(start.getTime()) && end <= start)) {
        return NextResponse.json({ ok: false, error: "INVALID_END_DATE", message: "End date/time must be a valid time after the event starts." }, { status: 400 });
      }
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        description,
        organizerName,
        performerName,
        endDate,
        seoSourceUrl: source.toString(),
        seoVerifiedAt: new Date(),
      },
      select: {
        id: true,
        description: true,
        organizerName: true,
        performerName: true,
        endDate: true,
        seoSourceUrl: true,
        seoVerifiedAt: true,
      },
    });

    return NextResponse.json({ ok: true, event: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save event search details.";
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message }, { status: 400 });
  }
}
