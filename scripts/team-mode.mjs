// Enciende o apaga el modo equipo de UN negocio (activación controlada).
//
//   npm run team:mode -- <slug> on
//   npm run team:mode -- <slug> off
//   npm run team:mode -- <slug> extra <n>     # cupos adicionales de profesionales (ampliación pactada)
//   npm run team:mode -- <slug>               # muestra el estado
//
// En producción (Docker Compose):
//   docker compose --env-file .env.production run --rm migrate \
//     node scripts/team-mode.mjs mi-negocio on
//
// Apagarlo no borra nada: los profesionales y sus turnos se conservan, pero
// el negocio vuelve a comportarse con un único profesional (el primero activo).
// Apagarlo con más de un profesional activo con turnos futuros deja a los
// demás sin agenda online: hacerlo solo después de resolver esos turnos.
// Es un cambio de configuración que queda en el registro de auditoría.

import { existsSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}

const [slug, action, value] = process.argv.slice(2);
if (!slug || !process.env.DATABASE_URL || (action && !["on", "off", "extra"].includes(action))) {
  console.error("Uso: node scripts/team-mode.mjs <slug> [on|off|extra <n>]   (requiere DATABASE_URL)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const found = await client.query('SELECT "id", "name", "teamModeEnabled", "extraProfessionals" FROM "organizations" WHERE "slug" = $1', [slug]);
  if (found.rowCount === 0) {
    console.error(`No existe un negocio con el enlace "${slug}".`);
    process.exitCode = 1;
  } else {
    const org = found.rows[0];
    if (action === "on" || action === "off") {
      await client.query('UPDATE "organizations" SET "teamModeEnabled" = $2, "updatedAt" = now() WHERE "id" = $1', [org.id, action === "on"]);
      await client.query(
        'INSERT INTO "audit_logs" ("id", "organizationId", "action", "entityType", "entityId") VALUES (gen_random_uuid(), $1, $2, $3, $1)',
        [org.id, `team_mode.${action}`, "organization"],
      );
    } else if (action === "extra") {
      const extra = Number(value);
      if (!Number.isInteger(extra) || extra < 0 || extra > 50) {
        console.error("El número de cupos adicionales tiene que ser un entero entre 0 y 50.");
        process.exit(1);
      }
      await client.query('UPDATE "organizations" SET "extraProfessionals" = $2, "updatedAt" = now() WHERE "id" = $1', [org.id, extra]);
      await client.query(
        'INSERT INTO "audit_logs" ("id", "organizationId", "action", "entityType", "entityId", "metadata") VALUES (gen_random_uuid(), $1, $2, $3, $1, $4)',
        [org.id, "team_mode.extra_professionals", "organization", JSON.stringify({ extra })],
      );
    }
    const now = (await client.query('SELECT "teamModeEnabled", "extraProfessionals" FROM "organizations" WHERE "id" = $1', [org.id])).rows[0];
    const active = (await client.query('SELECT count(*)::int AS n FROM "professionals" WHERE "organizationId" = $1 AND "active"', [org.id])).rows[0].n;
    console.log(`${org.name} (/${slug}): modo equipo ${now.teamModeEnabled ? "ENCENDIDO" : "apagado"} · cupos adicionales ${now.extraProfessionals} · profesionales activos ${active}`);
    if (process.env.TEAM_MODE_ENABLED === "1") console.log("Aviso: TEAM_MODE_ENABLED=1 enciende el modo equipo para toda la instalación, sin importar este valor.");
  }
} finally {
  await client.end();
}
