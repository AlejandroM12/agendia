import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/onboarding", "/api/internal", "/api/auth", "/api/webhooks", "/turno", "/vista-previa", "/invitacion", "/sin-acceso", "/*/mis-turnos"] }],
    sitemap: `${brand.url}/sitemap.xml`,
  };
}
