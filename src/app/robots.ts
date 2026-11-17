import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/siteUrl";

// Keep crawlers off the admin console, auth routes and the paused account pages.
// Every other public path stays open; sitemap.ts lists the canonical URLs to index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/content/images/", "/api/content/illustrations/"],
      disallow: [
        "/admin",
        "/api",
        "/auth",
        "/en/login",
        "/zh/login",
        "/en/signup",
        "/zh/signup",
      ],
    },
    sitemap: new URL("/sitemap.xml", getSiteUrl()).toString(),
  };
}
