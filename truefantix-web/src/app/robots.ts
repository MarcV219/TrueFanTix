import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/tickets", "/tickets/", "/events/", "/about/", "/faq/", "/forum"],
      disallow: [
        "/account/",
        "/admin/",
        "/api/",
        "/checkout",
        "/forgot-password",
        "/login",
        "/register",
        "/reset-password",
        "/verify",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
