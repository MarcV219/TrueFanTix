export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

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

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    const id = parseRequestIdFromUrl(req);
    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID", message: "Missing catalog request id." }, { status: 400 });
    }

    const validation = await validateRequest(schemas.catalogRequestReviewApi)(req);
    if (!validation.success) return validation.response;

    const { status, catalogEntityId, adminNotes } = validation.data;

    const request = await prisma.catalogRequest.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        requestedType: true,
        requestedValue: true,
      },
    });

    if (!request) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Catalog request not found." }, { status: 404 });
    }

    if (status === "REJECTED") {
      const rejected = await prisma.catalogRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          adminNotes: adminNotes || null,
          reviewedAt: new Date(),
          resolvedCatalogEntityId: null,
          fulfilledPreferenceId: null,
        },
      });
      return NextResponse.json({ ok: true, request: rejected }, { status: 200 });
    }

    const entity = await prisma.catalogEntity.findUnique({
      where: { id: catalogEntityId ?? "" },
      select: { id: true, type: true, canonicalName: true },
    });

    if (!entity) {
      return NextResponse.json(
        { ok: false, error: "CATALOG_ENTITY_NOT_FOUND", message: "Choose a valid catalog entity before fulfilling." },
        { status: 400 }
      );
    }

    if (entity.type !== request.requestedType) {
      return NextResponse.json(
        { ok: false, error: "CATALOG_TYPE_MISMATCH", message: "The catalog entity type does not match this request." },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const preference = await tx.notificationPreference.upsert({
        where: {
          userId_type_value: {
            userId: request.userId,
            type: entity.type,
            value: entity.canonicalName,
          },
        },
        create: {
          userId: request.userId,
          type: entity.type,
          value: entity.canonicalName,
          catalogEntityId: entity.id,
          status: "ACTIVE",
        },
        update: {
          catalogEntityId: entity.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
          type: true,
          value: true,
          status: true,
          catalogEntityId: true,
        },
      });

      const updatedRequest = await tx.catalogRequest.update({
        where: { id },
        data: {
          status: "FULFILLED",
          adminNotes: adminNotes || null,
          resolvedCatalogEntityId: entity.id,
          fulfilledPreferenceId: preference.id,
          reviewedAt: new Date(),
        },
      });

      return { request: updatedRequest, preference };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error("PATCH /api/admin/catalog-requests/[id] failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not review catalog request." },
      { status: 500 }
    );
  }
}
