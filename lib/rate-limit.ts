import "server-only";

import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Rate limiting de ventana fija respaldado por PostgreSQL.
 *
 * Un único UPSERT atómico por intento: funciona igual con una o varias
 * instancias de la app y no agrega infraestructura (Redis). Las filas
 * vencidas las limpia el proceso programado (modules/system/tick.ts).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "rate_limits" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limits"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1
        ELSE "rate_limits"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "rate_limits"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now()
        ELSE "rate_limits"."windowStart"
      END
    RETURNING "count"
  `;
  return { allowed: (rows[0]?.count ?? 1) <= limit };
}

/** IP del cliente según el proxy inverso (Caddy/plataforma). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

export const TOO_MANY_ATTEMPTS = "Demasiados intentos. Esperá unos minutos y volvé a probar.";
