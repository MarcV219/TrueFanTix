export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { checkRateLimit, getClientIp, rateLimitError } from "@/lib/rate-limit";
import { schemas } from "@/lib/validation";
import { calculateAdminFeeTax, getTaxRateForVenue } from "@/lib/tax-rates";
import { isTicketEventExpired } from "@/lib/tickets/expiry";
import {
  BuyerPurchaseAccessChangedError,
  ManagedAccountPurchaseError,
  runOrdinaryPurchase,
} from "@/lib/tickets/ordinary-buyer";

const ADMIN_FEE_BPS = 875; // 8.75%
const BPS_DENOMINATOR = 10_000;

const RESERVATION_MINUTES = 15;
const ACCESS_TOKEN_COST_PER_SOLDOUT_PURCHASE = 1;

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function normalizeCurrency(value: unknown): "CAD" | "USD" {
  return String(value || "CAD").trim().toUpperCase() === "USD" ? "USD" : "CAD";
}

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseTicketIdFromUrl(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ticketsIndex = parts.indexOf("tickets");
  if (ticketsIndex !== -1 && parts.length > ticketsIndex + 1) {
    return normalizeId(parts[ticketsIndex + 1]);
  }
  return "";
}

async function getTicketId(req: Request, ctx: Ctx): Promise<string> {
  const fromUrl = parseTicketIdFromUrl(req);
  if (fromUrl) return fromUrl;

  const p: any = ctx?.params;
  if (!p) return "";
  const resolved = typeof p?.then === "function" ? await p : p;
  return normalizeId(resolved?.id);
}

function getIdempotencyKey(req: Request): string {
  const fromHeader = normalizeId(req.headers.get("idempotency-key"));
  if (fromHeader) return fromHeader;

  const url = new URL(req.url);
  const fromQuery = normalizeId(url.searchParams.get("idempotencyKey"));
  return fromQuery;
}

export async function POST(req: Request, ctx: Ctx) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit({ key: `tickets:purchase:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rateLimitError(rl.retryAfterSec);

  // ✅ Step 3 enforcement: must be logged in + verified + not banned
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  // Preserve the fast capability refusal while rechecking the same field under
  // the buyer lock before any order lookup or reservation mutation.
  if (gate.user.canBuy !== true) {
    return NextResponse.json(
      { ok: false, error: "BUYING_DISABLED", message: "Buying is disabled for this account." },
      { status: 403 },
    );
  }

  try {
    const ticketId = await getTicketId(req, ctx);
    const url = new URL(req.url);

    // MVP: existing flow passes buyerSellerId; we must ensure it belongs to the logged-in user.
    const qpParsed = schemas.ticketPurchaseQuery.safeParse({
      buyerSellerId: url.searchParams.get("buyerSellerId"),
      idempotencyKey: url.searchParams.get("idempotencyKey"),
    });

    if (!qpParsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "VALIDATION_ERROR",
          message: "Invalid purchase parameters",
          details: qpParsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        },
        { status: 400 }
      );
    }

    const buyerSellerId = normalizeId(qpParsed.data.buyerSellerId);
    const idempotencyKey = getIdempotencyKey(req) || normalizeId(qpParsed.data.idempotencyKey);

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id in URL" },
        { status: 400 }
      );
    }

    if (!buyerSellerId) {
      return NextResponse.json(
        { ok: false, error: "Missing buyerSellerId" },
        { status: 400 }
      );
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { ok: false, error: "Missing idempotency key" },
        { status: 400 }
      );
    }

    const now = new Date();
    const reservedUntil = new Date(now.getTime() + RESERVATION_MINUTES * 60_000);

    const result = await runOrdinaryPurchase(gate.user.id, async (tx, currentUser) => {
      // Purchases must use the wallet reloaded beneath the current identity lock,
      // rather than the potentially stale relationship returned by the route guard.
      const loggedInBuyerSellerId = currentUser.seller.id;

      if (buyerSellerId !== loggedInBuyerSellerId) {
        return {
          ok: false as const,
          status: 403 as const,
          body: {
            ok: false,
            error: "FORBIDDEN_BUYER",
            message: "buyerSellerId does not match the logged-in user.",
          },
        };
      }

      const existingByKey = await tx.order.findUnique({ where: { idempotencyKey } });
      if (existingByKey) {
        if (existingByKey.buyerSellerId !== loggedInBuyerSellerId) {
          return {
            ok: false as const,
            status: 403 as const,
            body: {
              ok: false,
              error: "FORBIDDEN_BUYER",
              message: "Idempotency key belongs to a different buyer.",
            },
          };
        }

        return {
          ok: true as const,
          status: 200 as const,
          body: {
            ok: true,
            replay: true,
            order: {
              ...existingByKey,
              amount: centsToDollars(existingByKey.amountCents),
              adminFee: centsToDollars(existingByKey.adminFeeCents),
              adminFeeTax: centsToDollars(existingByKey.adminFeeTaxCents ?? 0),
              total: centsToDollars(existingByKey.totalCents),
            },
          },
        };
      }

      const buyer = currentUser.seller;

      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: { event: true },
      });

      if (!ticket) {
        return {
          ok: false as const,
          status: 404 as const,
          body: { ok: false, error: "Ticket not found", debug: { ticketId } },
        };
      }

      if (ticket.verificationStatus === "REJECTED") {
        return {
          ok: false as const,
          status: 409 as const,
          body: { ok: false, error: "Ticket failed verification and cannot be purchased" },
        };
      }

      if (isTicketEventExpired({ date: ticket.date || ticket.event?.date, venue: ticket.venue || ticket.event?.venue }, now)) {
        await tx.ticket.updateMany({
          where: {
            id: ticket.id,
            status: "AVAILABLE",
          },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: now,
            reservedByOrderId: null,
            reservedUntil: null,
          },
        });

        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "TICKET_EVENT_EXPIRED",
            message: "This ticket is for an event that has already started or passed.",
          },
        };
      }

      if (buyerSellerId === ticket.sellerId) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "You cannot buy your own ticket" },
        };
      }

      const soldOutEvent = ticket.event?.selloutStatus === "SOLD_OUT";

      if (soldOutEvent && (buyer.accessTokenBalance ?? 0) < ACCESS_TOKEN_COST_PER_SOLDOUT_PURCHASE) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "Insufficient access tokens to reserve sold-out event ticket" },
        };
      }

      const adminFeeCents = Math.round((ticket.priceCents * ADMIN_FEE_BPS) / BPS_DENOMINATOR);
      const currency = normalizeCurrency((ticket as any).currency);
      const taxRate = getTaxRateForVenue(ticket.event?.venue ?? ticket.venue);
      const adminFeeTax = calculateAdminFeeTax(adminFeeCents, taxRate);
      const totalCents = ticket.priceCents + adminFeeCents + adminFeeTax.taxCents;

      // Find an existing order for this ticket via OrderItem.
      const existingOrderItem = await tx.orderItem.findFirst({
        where: { ticketId: ticket.id },
        include: { order: true },
        orderBy: { createdAt: "desc" },
      });
      const existingOrderForTicket = existingOrderItem?.order ?? null;

      // Decide which orderId we will use for reservation
      let orderIdToUse: string;

      if (!existingOrderForTicket) {
        orderIdToUse = crypto.randomUUID();
      } else {
        if (existingOrderForTicket.status !== "CANCELLED") {
          return {
            ok: false as const,
            status: 409 as const,
            body: {
              ok: false,
              error: "Ticket already has an order and cannot be reserved again",
              debug: {
                ticketId: ticket.id,
                orderId: existingOrderForTicket.id,
                status: existingOrderForTicket.status,
              },
            },
          };
        }
        orderIdToUse = existingOrderForTicket.id;
      }

      // Atomic reservation
      const reserved = await tx.ticket.updateMany({
        where: {
          id: ticket.id,
          status: "AVAILABLE",
          OR: [{ reservedUntil: null }, { reservedUntil: { lt: now } }],
        },
        data: {
          status: "RESERVED",
          reservedByOrderId: orderIdToUse,
          reservedUntil,
        },
      });

      if (reserved.count !== 1) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Ticket not available (already reserved/sold/withdrawn)",
            debug: { ticketId: ticket.id },
          },
        };
      }

      // Create or reuse order
      const order =
        existingOrderForTicket == null
          ? await tx.order.create({
              data: {
                id: orderIdToUse,
                sellerId: ticket.sellerId,
                buyerSellerId,
                amountCents: ticket.priceCents,
                adminFeeCents,
                adminFeeTaxCents: adminFeeTax.taxCents,
                currency,
                taxRateBps: adminFeeTax.rateBps,
                taxRegionCode: adminFeeTax.regionCode || null,
                taxRegionName: adminFeeTax.regionName || null,
                taxCountryCode: adminFeeTax.countryCode || null,
                taxLabel: adminFeeTax.label,
                totalCents,
                status: "PENDING",
                idempotencyKey,
                items: {
                  create: {
                    ticketId: ticket.id,
                    priceCents: ticket.priceCents,
                    faceValueCents: ticket.faceValueCents,
                    currency,
                  },
                },
              },
            })
          : await tx.order.update({
              where: { id: orderIdToUse },
              data: {
                buyerSellerId,
                amountCents: ticket.priceCents,
                adminFeeCents,
                adminFeeTaxCents: adminFeeTax.taxCents,
                currency,
                taxRateBps: adminFeeTax.rateBps,
                taxRegionCode: adminFeeTax.regionCode || null,
                taxRegionName: adminFeeTax.regionName || null,
                taxCountryCode: adminFeeTax.countryCode || null,
                taxLabel: adminFeeTax.label,
                totalCents,
                status: "PENDING",
                idempotencyKey,
              },
            });

      const updatedTicket = await tx.ticket.findUnique({ where: { id: ticket.id } });

      return {
        ok: true as const,
        status: 201 as const,
        body: {
          ok: true,
          order: {
            ...order,
            amount: centsToDollars(order.amountCents),
            adminFee: centsToDollars(order.adminFeeCents),
            adminFeeTax: centsToDollars(order.adminFeeTaxCents ?? 0),
            total: centsToDollars(order.totalCents),
          },
          ticket: updatedTicket,
          soldOutEvent,
          reservation: { reservedUntil, minutes: RESERVATION_MINUTES },
        },
      };
    });

    if ((result as any)?.ok === false) {
      return NextResponse.json((result as any).body, { status: (result as any).status });
    }
    return NextResponse.json((result as any).body, { status: (result as any).status ?? 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (err instanceof ManagedAccountPurchaseError) {
      return NextResponse.json(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (err instanceof BuyerPurchaseAccessChangedError) {
      const responses = {
        NOT_AUTHENTICATED: [401, "Please log in."],
        BANNED: [403, "This account is restricted."],
        NOT_VERIFIED: [403, "Please verify your email and phone number."],
        BUYING_DISABLED: [403, "Buying is disabled for this account."],
        BUYER_WALLET_MISSING: [409, "Buyer wallet is not set up for this account."],
      } as const;
      const [status, accessMessage] = responses[err.code];
      return NextResponse.json(
        { ok: false, error: err.code, message: accessMessage },
        { status },
      );
    }

    // A unique collision is returned as a conflict. Idempotency replays are
    // resolved beneath the buyer lock before attempting a new reservation.
    if (err && typeof err === "object" && "code" in err && (err as any).code === "P2002") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Conflict: unique constraint (ticket already has an order, or idempotency key reused)",
          details: message,
        },
        { status: 409 }
      );
    }

    if (err && typeof err === "object" && "code" in err) {
      return NextResponse.json(
        { ok: false, error: "Purchase failed (Prisma)", code: (err as any).code, details: message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Purchase failed", details: message },
      { status: 500 }
    );
  }
}
