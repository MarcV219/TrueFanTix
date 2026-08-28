"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  ATTRIBUTION_STORAGE_KEY,
  sanitizeAttribution,
} from "@/lib/analytics/campaign-attribution";

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
    const attribution = sanitizeAttribution({
      source: params.get("utm_source"),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      content: params.get("utm_content"),
      term: params.get("utm_term"),
      firstPath: pathname,
      referrerHost: document.referrer,
    });

    try {
      const existing = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
      if (!existing && (attribution.source || attribution.referrerHost)) {
        window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
      }
    } catch {
      // Attribution is optional; traffic reporting should continue without it.
    }

    const payload = {
      visitorId: id,
      path: pathname,
      referrer: document.referrer || null,
      ...attribution,
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
