export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { saveWebVenueCandidate, searchWebVenueCandidates, type WebVenueCandidate } from "@/lib/catalog/web-venue-search";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseRequestIdFromUrl(req: Request) {
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf("catalog-requests");
  if (index !== -1 && parts.length > index + 1) return normalizeId(parts[index + 1]);
  return "";
}

const candidateSchema = z.object({
  type: z.literal("VENUE"),
  label: z.string().trim().min(1).max(200),
  canonicalName: z.string().trim().min(1).max(200),
  provider: z.enum(["web-search", "openstreetmap"]),
  providerId: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(500).optional().nullable(),
  address: z.string().trim().max(240).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(120).optional().nullable(),
  sourceUrl: z.string().trim().url().max(2048).optional().nullable(),
  confidence: z.number().min(0).max(100).optional().default(50),
  sourceName: z.string().trim().max(200).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    query: z.string().trim().min(2).max(200).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal("save"),
    candidate: candidateSchema,
  }),
]);

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    const id = parseRequestIdFromUrl(req);
    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID", message: "Missing catalog request id." }, { status: 400 });
    }

    const rawBody = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Invalid web search request.", details: parsed.error.issues.map((issue) => issue.message) },
        { status: 400 }
      );
    }

    const request = await prisma.catalogRequest.findUnique({
      where: { id },
      select: { id: true, requestedType: true, requestedValue: true },
    });

    if (!request) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Catalog request not found." }, { status: 404 });
    }

    if (request.requestedType !== "VENUE") {
      return NextResponse.json(
        { ok: false, error: "UNSUPPORTED_TYPE", message: "Web venue search is currently available for venue requests." },
        { status: 400 }
      );
    }

    if (parsed.data.action === "search") {
      const candidates = await searchWebVenueCandidates({
        query: parsed.data.query || request.requestedValue,
        limit: parsed.data.limit ?? 8,
      });
      return NextResponse.json({ ok: true, candidates }, { status: 200 });
    }

    const candidate: WebVenueCandidate = {
      ...parsed.data.candidate,
      providerId: parsed.data.candidate.providerId || "",
      subtitle: parsed.data.candidate.subtitle ?? undefined,
      address: parsed.data.candidate.address ?? undefined,
      city: parsed.data.candidate.city ?? undefined,
      region: parsed.data.candidate.region ?? undefined,
      country: parsed.data.candidate.country ?? undefined,
      sourceUrl: parsed.data.candidate.sourceUrl ?? undefined,
      sourceName: parsed.data.candidate.sourceName ?? undefined,
    };
    const entity = await saveWebVenueCandidate(candidate);

    return NextResponse.json(
      {
        ok: true,
        entity: {
          id: entity.id,
          type: entity.type,
          canonicalName: entity.canonicalName,
          provider: entity.provider,
          providerId: entity.providerId,
          subtitle: entity.subtitle,
          address: entity.address,
          city: entity.city,
          region: entity.region,
          country: entity.country,
          sourceUrl: entity.sourceUrl,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/admin/catalog-requests/[id]/web-search failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not search or save venue candidates." },
      { status: 500 }
    );
  }
}
