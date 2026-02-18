export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function normalizePhone(phone: string) {
  return phone.trim();
}

function isEmailLike(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type UpdateProfileBody = {
  firstName?: string;
  lastName?: string;
  displayName?: string | null;
  phone?: string;
  streetAddress1?: string;
  streetAddress2?: string | null;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export async function PATCH(req: Request) {
  try {
    const userId = await getUserIdFromSessionCookie();
    if (!userId) {
      return jsonError(401, "UNAUTHORIZED", "Please log in.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, isBanned: true },
    });

    if (!user) return jsonError(401, "UNAUTHORIZED", "Please log in.");
    if (user.isBanned) return jsonError(403, "BANNED", "This account is restricted.");

    let body: UpdateProfileBody;
    try {
      body = (await req.json()) as UpdateProfileBody;
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Invalid JSON body.");
    }

    // Build update object with validation
    const updateData: Partial<UpdateProfileBody> = {};

    // First name
    if (body.firstName !== undefined) {
      const firstName = body.firstName.trim();
      if (!firstName) return jsonError(400, "VALIDATION_ERROR", "First name is required.");
      if (firstName.length > 100) return jsonError(400, "VALIDATION_ERROR", "First name is too long.");
      updateData.firstName = firstName;
    }

    // Last name
    if (body.lastName !== undefined) {
      const lastName = body.lastName.trim();
      if (!lastName) return jsonError(400, "VALIDATION_ERROR", "Last name is required.");
      if (lastName.length > 100) return jsonError(400, "VALIDATION_ERROR", "Last name is too long.");
      updateData.lastName = lastName;
    }

    // Display name (optional, can be null/empty)
    if (body.displayName !== undefined) {
      const displayName = body.displayName?.trim() || null;
      if (displayName && displayName.length > 100) {
        return jsonError(400, "VALIDATION_ERROR", "Display name is too long.");
      }
      updateData.displayName = displayName;
    }

    // Phone (with uniqueness check)
    if (body.phone !== undefined) {
      const phone = normalizePhone(body.phone);
      if (!phone) return jsonError(400, "VALIDATION_ERROR", "Phone number is required.");
      if (phone.length < 7) return jsonError(400, "VALIDATION_ERROR", "Enter a valid phone number.");
      if (phone.length > 50) return jsonError(400, "VALIDATION_ERROR", "Phone number is too long.");
      
      // Check uniqueness if changed
      if (phone !== user.phone) {
        const existing = await prisma.user.findUnique({
          where: { phone },
          select: { id: true },
        });
        if (existing) {
          return jsonError(409, "PHONE_IN_USE", "That phone number is already in use.");
        }
      }
      updateData.phone = phone;
    }

    // Address fields
    if (body.streetAddress1 !== undefined) {
      const addr = body.streetAddress1.trim();
      if (!addr) return jsonError(400, "VALIDATION_ERROR", "Street address is required.");
      if (addr.length > 200) return jsonError(400, "VALIDATION_ERROR", "Street address is too long.");
      updateData.streetAddress1 = addr;
    }

    if (body.streetAddress2 !== undefined) {
      const addr2 = body.streetAddress2?.trim() || null;
      if (addr2 && addr2.length > 200) {
        return jsonError(400, "VALIDATION_ERROR", "Street address 2 is too long.");
      }
      updateData.streetAddress2 = addr2;
    }

    if (body.city !== undefined) {
      const city = body.city.trim();
      if (!city) return jsonError(400, "VALIDATION_ERROR", "City is required.");
      if (city.length > 100) return jsonError(400, "VALIDATION_ERROR", "City is too long.");
      updateData.city = city;
    }

    if (body.region !== undefined) {
      const region = body.region.trim();
      if (!region) return jsonError(400, "VALIDATION_ERROR", "Province/State is required.");
      if (region.length > 100) return jsonError(400, "VALIDATION_ERROR", "Province/State is too long.");
      updateData.region = region;
    }

    if (body.postalCode !== undefined) {
      const postal = body.postalCode.trim();
      if (!postal) return jsonError(400, "VALIDATION_ERROR", "Postal/ZIP code is required.");
      if (postal.length > 20) return jsonError(400, "VALIDATION_ERROR", "Postal/ZIP code is too long.");
      updateData.postalCode = postal;
    }

    if (body.country !== undefined) {
      const country = body.country.trim();
      if (!country) return jsonError(400, "VALIDATION_ERROR", "Country is required.");
      if (country.length > 100) return jsonError(400, "VALIDATION_ERROR", "Country is too long.");
      updateData.country = country;
    }

    // Ensure there's something to update
    if (Object.keys(updateData).length === 0) {
      return jsonError(400, "VALIDATION_ERROR", "No fields provided to update.");
    }

    // Perform update
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

    return NextResponse.json({
      ok: true,
      user: updatedUser,
      message: "Profile updated successfully.",
    }, { status: 200 });

  } catch (err: any) {
    console.error("PATCH /api/account/profile error:", err);
    return jsonError(500, "SERVER_ERROR", "An unexpected error occurred.");
  }
}
