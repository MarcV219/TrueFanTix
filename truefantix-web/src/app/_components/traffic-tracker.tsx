"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const VISITOR_KEY = "tft_anonymous_visitor";

function visitorId(): string | null {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = window.crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export default function TrafficTracker() {
  const pathname = usePathname() || "/";

  useEffect(() => {
    if (navigator.doNotTrack === "1") return;
    const id = visitorId();
    if (!id) return;

    const params = new URLSearchParams(window.location.search);
    const payload = {
      visitorId: id,
      path: pathname,
      referrer: document.referrer || null,
      source: params.get("utm_source"),
      campaign: params.get("utm_campaign"),
    };

    void fetch("/api/analytics/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
