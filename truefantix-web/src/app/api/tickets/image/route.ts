import { NextResponse } from "next/server";
import { getTicketImage, getPlaceholderImage } from "@/lib/imageSearch";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const title = searchParams.get("title");
    const eventType = searchParams.get("eventType") || "other";
    
    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }
    
    // Get image (searches web or returns placeholder)
    const imageUrl = await getTicketImage(title, eventType);
    
    const isPlaceholder = imageUrl.startsWith("/");
    const imageSource = isPlaceholder ? "placeholder" : "brave";
    const imageReason = isPlaceholder
      ? "no-usable-auto-image-placeholder"
      : "auto-image-selected";

    return NextResponse.json({
      imageUrl,
      isPlaceholder,
      imageSource,
      imageReason,
    });
  } catch (error) {
    console.error("Image fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch image" },
      { status: 500 }
    );
  }
}
