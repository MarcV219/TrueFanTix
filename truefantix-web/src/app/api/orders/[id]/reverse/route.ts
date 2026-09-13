export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { refundOrderAccessTokens } from "@/lib/accessTokenHolds";

import { requireAdmin } from "@/lib/auth/guards";
import {
  AdminOperationAccessChangedError,
  ManagedAccountAdminOperationError,
  runOrdinaryAdminOperation,
} from "@/lib/admin/ordinary-admin";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const params = await ctx.params;
    const orderId = params?.id;
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Order ID is required." },
        { status: 400 }
      );
    }

    const result = await runOrdinaryAdminOperation(gate.user.id, async (tx) => {
      // Serialize reversal with every other order workflow before reading its
      // state, so only one transition can restore tickets and access tokens.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { ticket: true } },
          payment: true,
        },
      });

      if (!order) {
        return { ok: false, error: "NOT_FOUND", message: "Order not found." };
      }

      const allowed = ["PAID", "DELIVERED", "COMPLETED"];
      if (!allowed.includes(order.status)) {
        return {
          ok: false,
          error: "BAD_STATE",
          message: `Cannot reverse order in status: ${order.status}`,
        };
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED" },
      });

      const ticketIds = order.items.map((item) => item.ticketId);
      if (ticketIds.length > 0) {
        await tx.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: { status: "AVAILABLE", reservedByOrderId: null, updatedAt: new Date() },
        });
      }

      await refundOrderAccessTokens(tx, order.id);

      return { ok: true, message: "Order reversed and tickets restored." };
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, message: result.message },
        { status: result.error === "NOT_FOUND" ? 404 : 400 }
      );
    }

    return NextResponse.json({ ok: true, message: result.message });
  } catch (err: unknown) {
    if (err instanceof ManagedAccountAdminOperationError) {
      return NextResponse.json(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (err instanceof AdminOperationAccessChangedError) {
      const responses = {
        NOT_AUTHENTICATED: [401, "Please log in."],
        BANNED: [403, "This account is restricted."],
        NOT_VERIFIED: [403, "Please verify your email and phone number."],
        FORBIDDEN: [403, "Not authorized."],
      } as const;
      const [status, message] = responses[err.code];
      return NextResponse.json({ ok: false, error: err.code, message }, { status });
    }

    console.error("POST /api/orders/[id]/reverse error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not reverse order." },
      { status: 500 }
    );
  }
}
