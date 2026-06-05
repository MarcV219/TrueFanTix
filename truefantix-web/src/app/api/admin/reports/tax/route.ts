export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

const REPORT_STATUSES = ["PAID", "DELIVERED", "COMPLETED"] as const;

function centsToDollars(cents: number | null | undefined) {
  return Number(((cents ?? 0) / 100).toFixed(2));
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function parseDateRange(req: Request) {
  const url = new URL(req.url);
  const fromRaw = (url.searchParams.get("from") || "").trim();
  const toRaw = (url.searchParams.get("to") || "").trim();
  const format = (url.searchParams.get("format") || "json").toLowerCase();

  const fromDate = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
  const toDate = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;

  const createdAt: any = {};
  if (fromDate && !Number.isNaN(fromDate.getTime())) createdAt.gte = fromDate;
  if (toDate && !Number.isNaN(toDate.getTime())) createdAt.lte = toDate;

  return {
    fromRaw,
    toRaw,
    format,
    createdAt: Object.keys(createdAt).length ? createdAt : undefined,
  };
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const { fromRaw, toRaw, format, createdAt } = parseDateRange(req);

  const orders = await prisma.order.findMany({
    where: {
      status: { in: [...REPORT_STATUSES] },
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      status: true,
      amountCents: true,
      adminFeeCents: true,
      adminFeeTaxCents: true,
      taxRateBps: true,
      taxRegionCode: true,
      taxRegionName: true,
      taxCountryCode: true,
      taxLabel: true,
      totalCents: true,
      payment: { select: { providerRef: true, status: true } },
      items: {
        take: 1,
        select: {
          ticket: { select: { title: true, venue: true, date: true } },
        },
      },
    },
  });

  const summary = orders.reduce(
    (acc, order) => {
      acc.orderCount += 1;
      acc.ticketSubtotalCents += order.amountCents;
      acc.adminFeeCents += order.adminFeeCents;
      acc.adminFeeTaxCents += order.adminFeeTaxCents;
      acc.totalCents += order.totalCents;
      return acc;
    },
    { orderCount: 0, ticketSubtotalCents: 0, adminFeeCents: 0, adminFeeTaxCents: 0, totalCents: 0 }
  );

  const byRegion = new Map<string, typeof summary & {
    taxCountryCode: string | null;
    taxRegionCode: string | null;
    taxRegionName: string | null;
    taxLabel: string | null;
    taxRateBps: number;
  }>();

  for (const order of orders) {
    const key = [
      order.taxCountryCode || "",
      order.taxRegionCode || "",
      order.taxRateBps,
      order.taxLabel || "",
    ].join("|");
    const existing = byRegion.get(key) ?? {
      taxCountryCode: order.taxCountryCode,
      taxRegionCode: order.taxRegionCode,
      taxRegionName: order.taxRegionName,
      taxLabel: order.taxLabel,
      taxRateBps: order.taxRateBps,
      orderCount: 0,
      ticketSubtotalCents: 0,
      adminFeeCents: 0,
      adminFeeTaxCents: 0,
      totalCents: 0,
    };

    existing.orderCount += 1;
    existing.ticketSubtotalCents += order.amountCents;
    existing.adminFeeCents += order.adminFeeCents;
    existing.adminFeeTaxCents += order.adminFeeTaxCents;
    existing.totalCents += order.totalCents;
    byRegion.set(key, existing);
  }

  const regionRows = Array.from(byRegion.values())
    .sort((a, b) => {
      const ak = `${a.taxCountryCode || ""}-${a.taxRegionCode || ""}`;
      const bk = `${b.taxCountryCode || ""}-${b.taxRegionCode || ""}`;
      return ak.localeCompare(bk);
    })
    .map((row) => ({
      ...row,
      ticketSubtotal: centsToDollars(row.ticketSubtotalCents),
      adminFee: centsToDollars(row.adminFeeCents),
      adminFeeTax: centsToDollars(row.adminFeeTaxCents),
      total: centsToDollars(row.totalCents),
    }));

  const orderRows = orders.map((order) => ({
    id: order.id,
    createdAt: order.createdAt.toISOString(),
    status: order.status,
    ticketTitle: order.items[0]?.ticket?.title ?? "",
    venue: order.items[0]?.ticket?.venue ?? "",
    eventDate: order.items[0]?.ticket?.date ?? "",
    taxCountryCode: order.taxCountryCode,
    taxRegionCode: order.taxRegionCode,
    taxRegionName: order.taxRegionName,
    taxLabel: order.taxLabel,
    taxRateBps: order.taxRateBps,
    ticketSubtotal: centsToDollars(order.amountCents),
    adminFee: centsToDollars(order.adminFeeCents),
    adminFeeTax: centsToDollars(order.adminFeeTaxCents),
    total: centsToDollars(order.totalCents),
    paymentStatus: order.payment?.status ?? "",
    paymentRef: order.payment?.providerRef ?? "",
  }));

  if (format === "csv") {
    const header = [
      "orderId",
      "createdAt",
      "status",
      "ticketTitle",
      "venue",
      "eventDate",
      "taxCountryCode",
      "taxRegionCode",
      "taxRegionName",
      "taxLabel",
      "taxRateBps",
      "ticketSubtotal",
      "adminFee",
      "adminFeeTax",
      "total",
      "paymentStatus",
      "paymentRef",
    ];
    const rows = orderRows.map((row) => header.map((key) => csvEscape((row as any)[key])).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const suffix = `${fromRaw || "all"}-${toRaw || "all"}`;

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="truefantix-admin-fee-tax-${suffix}.csv"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    filters: {
      from: fromRaw || null,
      to: toRaw || null,
      statuses: REPORT_STATUSES,
    },
    summary: {
      ...summary,
      ticketSubtotal: centsToDollars(summary.ticketSubtotalCents),
      adminFee: centsToDollars(summary.adminFeeCents),
      adminFeeTax: centsToDollars(summary.adminFeeTaxCents),
      total: centsToDollars(summary.totalCents),
    },
    regions: regionRows,
    orders: orderRows,
  });
}
