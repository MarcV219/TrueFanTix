export const runtime = "nodejs";

import { NextResponse } from "next/server";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("url") || "").trim();
    if (!raw) return bad("Missing url");

    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return bad("Invalid url");
    }

    if (!["http:", "https:"].includes(u.protocol)) {
      return bad("Unsupported protocol");
    }

    const upstream = await fetch(u.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
        "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "referer": "https://truefantix-web.vercel.app/",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!upstream.ok) {
      return bad(`Upstream ${upstream.status}`, 502);
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const bytes = await upstream.arrayBuffer();

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (e: any) {
    return bad(e?.message || "Proxy error", 500);
  }
}
