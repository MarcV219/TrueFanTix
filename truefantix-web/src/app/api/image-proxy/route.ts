export const runtime = "nodejs";

import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function allowedHosts() {
  return new Set((process.env.IMAGE_PROXY_ALLOWED_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function isBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = /^(172)\.(\d+)\./.exec(host);
  if (match && Number(match[2]) >= 16 && Number(match[2]) <= 31) return true;
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  return false;
}

export function isAllowedImageProxyUrl(url: URL, hosts = allowedHosts()) {
  return url.protocol === "https:" && !url.username && !url.password && !isBlockedHostname(url.hostname) && hosts.has(url.hostname.toLowerCase());
}

async function fetchAllowedImage(url: URL, hosts: Set<string>) {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!isAllowedImageProxyUrl(current, hosts)) throw new Error("Image host is not allowed");
    const response = await fetch(current, {
      headers: {
        "user-agent": "TrueFanTix-Image-Proxy/1.0",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) throw new Error("Unsafe or excessive image redirect");
    current = new URL(location, current);
  }
  throw new Error("Image redirect limit exceeded");
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

    const hosts = allowedHosts();
    if (!isAllowedImageProxyUrl(u, hosts)) return bad("Image host is not allowed", 403);
    const upstream = await fetchAllowedImage(u, hosts);

    if (!upstream.ok) {
      return bad(`Upstream ${upstream.status}`, 502);
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!new Set(["image/avif", "image/webp", "image/png", "image/jpeg", "image/gif"]).has(contentType)) return bad("Upstream did not return a supported image", 415);
    const declaredSize = Number(upstream.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) return bad("Image is too large", 413);
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) return bad("Image is too large", 413);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Proxy error";
    return bad(message, 502);
  }
}
