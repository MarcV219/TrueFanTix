export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import { schemas, validateRequest } from "@/lib/validation";

const ADMIN_EMAIL = "admin@truefantix.com";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeRequestedValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function adminEmail({
  requestId,
  type,
  value,
  notes,
  user,
}: {
  requestId: string;
  type: string;
  value: string;
  notes?: string | null;
  user: { id: string; email: string; firstName: string; lastName: string };
}) {
  const subject = `Catalog request: ${type} - ${value}`;
  const text = `A TrueFanTix user requested a missing notification catalog item.

Request ID: ${requestId}
Type: ${type}
Requested value: ${value}
User: ${user.firstName} ${user.lastName} <${user.email}>
User ID: ${user.id}
Notes: ${notes || "None"}

Research the canonical artist/team/venue/city, add or connect the correct CatalogEntity, then fulfill the request so the item is added to the user's notification favorites.`;

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
  <h2>Missing catalog item request</h2>
  <p>A TrueFanTix user requested a missing notification catalog item.</p>
  <table style="border-collapse: collapse;">
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">Request ID</td><td>${escapeHtml(requestId)}</td></tr>
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">Type</td><td>${escapeHtml(type)}</td></tr>
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">Requested value</td><td>${escapeHtml(value)}</td></tr>
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">User</td><td>${escapeHtml(`${user.firstName} ${user.lastName}`)} &lt;${escapeHtml(user.email)}&gt;</td></tr>
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">User ID</td><td>${escapeHtml(user.id)}</td></tr>
    <tr><td style="font-weight: 700; padding: 4px 10px 4px 0;">Notes</td><td>${escapeHtml(notes || "None")}</td></tr>
  </table>
  <p>Research the canonical artist/team/venue/city, add or connect the correct CatalogEntity, then fulfill the request so the item is added to the user's notification favorites.</p>
</body>
</html>`;

  return { subject, text, html };
}

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.catalogRequestCreateApi)(req);
    if (!validation.success) return validation.response;

    const type = validation.data.type;
    const value = normalizeRequestedValue(validation.data.value);
    const notes = validation.data.notes?.trim() || null;

    const existingPreference = await prisma.notificationPreference.findUnique({
      where: { userId_type_value: { userId: gate.user.id, type, value } },
      select: { id: true, type: true, value: true, status: true, catalogEntityId: true },
    });

    if (existingPreference) {
      return NextResponse.json({ ok: true, preference: existingPreference, alreadyExists: true }, { status: 200 });
    }

    let request = await prisma.catalogRequest.upsert({
      where: {
        userId_requestedType_requestedValue: {
          userId: gate.user.id,
          requestedType: type,
          requestedValue: value,
        },
      },
      create: {
        userId: gate.user.id,
        requestedType: type,
        requestedValue: value,
        notes,
        status: "PENDING",
      },
      update: {
        notes,
        status: "PENDING",
        adminNotes: null,
        reviewedAt: null,
      },
      select: {
        id: true,
        requestedType: true,
        requestedValue: true,
        status: true,
        emailSentAt: true,
        createdAt: true,
      },
    });

    const emailContent = adminEmail({
      requestId: request.id,
      type,
      value,
      notes,
      user: {
        id: gate.user.id,
        email: gate.user.email,
        firstName: gate.user.firstName,
        lastName: gate.user.lastName,
      },
    });
    const emailResult = await sendEmail({
      to: ADMIN_EMAIL,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    request = await prisma.catalogRequest.update({
      where: { id: request.id },
      data: emailResult.ok ? { emailSentAt: new Date(), emailError: null } : { emailError: emailResult.error ?? "Email failed" },
      select: {
        id: true,
        requestedType: true,
        requestedValue: true,
        status: true,
        emailSentAt: true,
        createdAt: true,
      },
    });

    if (!emailResult.ok) {
      console.error("Catalog request admin email failed:", emailResult.error);
    }

    return NextResponse.json(
      {
        ok: true,
        request,
        message: "Request sent. TrueFanTix will research it and add it to your notifications when it is verified.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/catalog/requests failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not submit catalog request." },
      { status: 500 }
    );
  }
}
