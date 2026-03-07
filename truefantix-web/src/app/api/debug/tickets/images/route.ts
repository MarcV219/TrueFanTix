export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTicketImage } from "@/lib/imageSearch";
import { getEventType } from "@/lib/ticketsView";

function normalizeBaseTitle(title: string) {
  return (title || "").replace(/\s*\(Alt\s*\d+\)\s*$/i, "").trim();
}

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
        const storedIsPlaceholder = String(storedImage).startsWith("/");

        let updateImage: string | null = null;
        let rehydrateStrategy: "auto" | "sibling" | "none" = "none";

        // Primary strategy: use fresh auto-image if non-placeholder
        if (
          rehydrate &&
          !!fetchedImage &&
          !fetchedIsPlaceholder &&
          (storedImage !== fetchedImage || storedIsPlaceholder)
        ) {
          updateImage = fetchedImage;
          rehydrateStrategy = "auto";
        }

        // Secondary strategy: if auto returns placeholder, try sibling ticket with same base title.
        if (rehydrate && !updateImage && storedIsPlaceholder && fetchedIsPlaceholder) {
          const baseTitle = normalizeBaseTitle(t.title);
          const sibling = await prisma.ticket.findFirst({
            where: {
              id: { not: t.id },
              status: { in: ["AVAILABLE", "SOLD"] },
              image: { notIn: ["", "/default.jpg", "/concert-placeholder.jpg", "/sports-placeholder.jpg", "/theatre-placeholder.jpg", "/comedy-placeholder.jpg", "/conference-placeholder.jpg", "/festival-placeholder.jpg", "/gala-placeholder.jpg", "/opera-placeholder.jpg", "/workshop-placeholder.jpg", "/basketball-placeholder.jpg", "/football-placeholder.jpg", "/hockey-placeholder.jpg"], not: null },
              title: { startsWith: baseTitle },
            },
            orderBy: { createdAt: "desc" },
            select: { image: true },
          });

          if (sibling?.image) {
            updateImage = sibling.image;
            rehydrateStrategy = "sibling";
          }
        }

        const shouldUpdate = !!updateImage;

        if (shouldUpdate) {
          await prisma.ticket.update({
            where: { id: t.id },
            data: { image: updateImage! },
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
          storedIsPlaceholder,
          fetchedImage,
          fetchedIsPlaceholder,
          fetchedImageSource: fetchedIsPlaceholder ? "placeholder" : "brave",
          fetchedImageReason: fetchedIsPlaceholder
            ? "no-usable-auto-image-placeholder"
            : "auto-image-selected",
          rehydrated: shouldUpdate,
          rehydrateStrategy,
          updatedImage: updateImage,
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
