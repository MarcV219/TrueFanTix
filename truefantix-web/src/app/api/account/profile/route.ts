export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function normalizePhone(phone: string) {
  return phone.trim().replace(/[^\d+]/g, "");
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;
    const userId = gate.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, isBanned: true },
    });

    if (!user) return jsonError(401, "UNAUTHORIZED", "Please log in.");
    if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");

    const validation = await validateRequest(schemas.accountProfileUpdate)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    const updateData: Record<string, any> = {};

    if (body.firstName !== undefined) updateData.firstName = body.firstName;
    if (body.lastName !== undefined) updateData.lastName = body.lastName;
    if (body.displayName !== undefined) updateData.displayName = body.displayName ?? null;

    if (body.phone !== undefined) {
      const phone = normalizePhone(body.phone);
      if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
        return jsonError(400, "PHONE_INVALID", "Phone must include country code, for example +17057954131.");
      }
      if (phone !== user.phone) {
        const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
        if (existing) {
          return jsonError(409, "PHONE_IN_USE", "That phone number is already in use.");
        }
        updateData.phoneVerifiedAt = null;
      }
      updateData.phone = phone;
    }

    if (body.streetAddress1 !== undefined) updateData.streetAddress1 = body.streetAddress1;
    if (body.streetAddress2 !== undefined) updateData.streetAddress2 = body.streetAddress2 ?? null;
    if (body.city !== undefined) updateData.city = body.city;
    if (body.region !== undefined) updateData.region = body.region;
    if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
    if (body.country !== undefined) updateData.country = body.country;

    if (Object.keys(updateData).length === 0) {
      return jsonError(400, "VALIDATION_ERROR", "No fields provided to update.");
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        phone: true,
        streetAddress1: true,
        streetAddress2: true,
        city: true,
        region: true,
        postalCode: true,
        country: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        user: updatedUser,
        message: "Profile updated successfully.",
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("PATCH /api/account/profile error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
