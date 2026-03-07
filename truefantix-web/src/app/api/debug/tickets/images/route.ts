export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTicketImage } from "@/lib/imageSearch";
import { getEventType } from "@/lib/ticketsView";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const take = Math.min(Math.max(Number(searchParams.get("take") || 25), 1), 100);
    const rehydrate = searchParams.get("rehydrate") === "1";

    const tickets = await prisma.ticket.findMany({
      where: { status: { in: ["AVAILABLE", "SOLD"] } },
      orderBy: { createdAt: "desc" },
      take,
      include: { event: true },
    });

    const rows = await Promise.all(
      tickets.map(async (t) => {
        const eventType = getEventType(t.title).type;
        const fetchedImage = await getTicketImage(t.title, eventType);
        const fetchedIsPlaceholder = fetchedImage.startsWith("/");
        const storedImage = t.image || "";

        const shouldUpdate =
          rehydrate &&
          !!fetchedImage &&
          !fetchedIsPlaceholder &&
          (storedImage !== fetchedImage || storedImage.startsWith("/"));

        if (shouldUpdate) {
          await prisma.ticket.update({
            where: { id: t.id },
            data: { image: fetchedImage },
          });
        }

        return {
          id: t.id,
          title: t.title,
          status: t.status,
          eventType,
          venue: t.venue,
          date: t.date,
          storedImage,
          storedIsPlaceholder: String(storedImage).startsWith("/"),
          fetchedImage,
          fetchedIsPlaceholder,
          fetchedImageSource: fetchedIsPlaceholder ? "placeholder" : "brave",
          fetchedImageReason: fetchedIsPlaceholder
            ? "no-usable-auto-image-placeholder"
            : "auto-image-selected",
          rehydrated: shouldUpdate,
          eventSelloutStatus: t.event?.selloutStatus ?? null,
          createdAt: t.createdAt,
        };
      })
    );

    const rehydratedCount = rows.filter((r) => r.rehydrated).length;

    return NextResponse.json({
      ok: true,
      take,
      rehydrate,
      count: rows.length,
      rehydratedCount,
      rows,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "DEBUG_TICKETS_IMAGES_FAILED",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
