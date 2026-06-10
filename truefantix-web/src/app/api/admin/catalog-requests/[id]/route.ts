export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
import { sendEmail } from "@/lib/email";

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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clarificationEmail({
  request,
  question,
}: {
  request: {
    requestedType: string;
    requestedValue: string;
    user: { firstName: string; email: string };
  };
  question: string;
}) {
  const subject = `More information needed for your TrueFanTix ${request.requestedType.toLowerCase()} request`;
  const text = `Hi ${request.user.firstName || "there"},

We need a little more information before we can add this notification favorite.

Request: ${request.requestedValue}
Type: ${request.requestedType}

Question from TrueFanTix:
${question}

Please reply to this email with the missing details.`;

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
  <p>Hi ${escapeHtml(request.user.firstName || "there")},</p>
  <p>We need a little more information before we can add this notification favorite.</p>
  <table style="border-collapse: collapse;">
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">Request</td><td>${escapeHtml(request.requestedValue)}</td></tr>
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">Type</td><td>${escapeHtml(request.requestedType)}</td></tr>
  </table>
  <p style="font-weight: 700;">Question from TrueFanTix:</p>
  <p>${escapeHtml(question).replaceAll("\n", "<br>")}</p>
  <p>Please reply to this email with the missing details.</p>
</body>
</html>`;

  return { subject, text, html };
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
        user: {
          select: {
            email: true,
            firstName: true,
          },
        },
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

    if (status === "NEEDS_CLARIFICATION") {
      const question = adminNotes?.trim() || "Please send us a little more information about the item you want added.";
      const emailContent = clarificationEmail({ request, question });
      const emailResult = await sendEmail({
        to: request.user.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });

      const clarificationRequest = await prisma.catalogRequest.update({
        where: { id },
        data: {
          status: "NEEDS_CLARIFICATION",
          adminNotes: question,
          reviewedAt: new Date(),
          resolvedCatalogEntityId: null,
          fulfilledPreferenceId: null,
          emailError: emailResult.ok ? null : emailResult.error ?? "Clarification email failed",
        },
      });

      if (!emailResult.ok) {
        console.error("Catalog request clarification email failed:", emailResult.error);
      }

      return NextResponse.json(
        {
          ok: true,
          request: clarificationRequest,
          emailSent: emailResult.ok,
          emailError: emailResult.error,
        },
        { status: 200 }
      );
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
