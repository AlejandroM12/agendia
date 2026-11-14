// Verifica la integridad de los datos de equipos después de migrar (solo lectura).
//
//   npm run team:verify
//   docker compose --env-file .env.production run --rm migrate node scripts/verify-team-data.mjs
//
// Informa, sin modificar nada:
//  - negocios sin ningún profesional o sin profesional activo,
//  - negocios con más de un profesional (caso no esperado antes de los equipos),
//  - horarios sin profesional,
//  - turnos cuyo profesional es de otra organización (la base lo impide),
//  - negocios con más profesionales activos que cupos del plan (se calcula en la app; acá solo el conteo),
//  - totales para comparar contra la copia previa a la migración.
// Termina con código 1 si encuentra algo que impida cerrar la migración.

import { existsSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}
if (!process.env.DATABASE_URL) {
  console.error("Requiere DATABASE_URL.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const one = async (sql) => (await client.query(sql)).rows[0];
const rows = async (sql) => (await client.query(sql)).rows;

let blocking = 0;
const report = (label, value, { blocks = false, detail } = {}) => {
  const bad = blocks && Number(value) > 0;
  if (bad) blocking++;
  console.log(`${bad ? "✗" : "·"} ${label}: ${value}${detail ? ` ${detail}` : ""}`);
};

try {
  const totals = await one(`SELECT
    (SELECT count(*) FROM organizations)::int AS organizations,
    (SELECT count(*) FROM professionals)::int AS professionals,
    (SELECT count(*) FROM professionals WHERE active)::int AS active_professionals,
    (SELECT count(*) FROM appointments)::int AS appointments,
    (SELECT count(*) FROM availability_rules)::int AS rules,
    (SELECT count(*) FROM availability_exceptions)::int AS exceptions,
    (SELECT count(*) FROM services)::int AS services,
    (SELECT count(*) FROM customers)::int AS customers`);
  console.log("Totales (comparar con los de antes de migrar):");
  for (const [key, value] of Object.entries(totals)) console.log(`  ${key}: ${value}`);
  console.log("");

  report("Negocios sin ningún profesional", (await one(`SELECT count(*)::int AS n FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM professionals p WHERE p."organizationId" = o.id)`)).n, { blocks: true });
  report("Horarios sin profesional", (await one(`SELECT count(*)::int AS n FROM availability_rules WHERE "professionalId" IS NULL`)).n, { blocks: true });
  report(
    "Turnos con profesional de otra organización",
    (await one(`SELECT count(*)::int AS n FROM appointments a JOIN professionals p ON p.id = a."professionalId" WHERE p."organizationId" <> a."organizationId"`)).n,
    { blocks: true },
  );
  report(
    "Horarios de un profesional de otra organización",
    (await one(`SELECT count(*)::int AS n FROM availability_rules r JOIN professionals p ON p.id = r."professionalId" WHERE p."organizationId" <> r."organizationId"`)).n,
    { blocks: true },
  );
  report("Negocios con profesionales pero ninguno activo", (await one(`SELECT count(*)::int AS n FROM organizations o WHERE EXISTS (SELECT 1 FROM professionals p WHERE p."organizationId" = o.id) AND NOT EXISTS (SELECT 1 FROM professionals p WHERE p."organizationId" = o.id AND p.active)`)).n, {
    detail: "(no bloquea: no reciben reservas hasta activar uno)",
  });
  const several = await rows(`SELECT o.slug, count(*)::int AS professionals FROM professionals p JOIN organizations o ON o.id = p."organizationId" GROUP BY o.slug HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 20`);
  report("Negocios con más de un profesional", several.length, { detail: several.length ? `→ ${several.map((r) => `${r.slug} (${r.professionals})`).join(", ")}` : "" });
  report("Negocios con modo equipo encendido", (await one(`SELECT count(*)::int AS n FROM organizations WHERE "teamModeEnabled"`)).n);

  console.log(blocking === 0 ? "\nOK: nada impide cerrar la migración." : `\n${blocking} problema(s) bloqueante(s): resolverlos antes de continuar.`);
  process.exitCode = blocking === 0 ? 0 : 1;
} finally {
  await client.end();
}
