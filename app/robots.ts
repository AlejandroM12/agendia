import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/onboarding", "/api", "/turno"] }],
    sitemap: `${brand.url}/sitemap.xml`,
  };
}
