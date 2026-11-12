// Otorga (o quita) el acceso al panel de plataforma /admin a una cuenta.
//
//   npm run admin:grant -- tu@email.com            # otorgar
//   npm run admin:grant -- tu@email.com --revoke   # quitar
//
// En producción (Docker Compose):
//   docker compose --env-file .env.production run --rm migrate \
//     node scripts/grant-admin.mjs tu@email.com
//
// Se ejecuta desde el servidor a propósito: quien puede correr este script ya
// tiene acceso a la base de datos. La cuenta tiene que existir (registrarla
// primero desde la app).

import { existsSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}

const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes("--revoke");

if (!email || email.startsWith("--") || !process.env.DATABASE_URL) {
  console.error("Uso: node scripts/grant-admin.mjs <email> [--revoke]   (requiere DATABASE_URL)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // sessionVersion + 1: el cambio de permisos cierra las sesiones abiertas.
  const result = await client.query(
    'UPDATE "users" SET "isPlatformAdmin" = $2, "sessionVersion" = "sessionVersion" + 1, "updatedAt" = now() WHERE "email" = $1 RETURNING "id"',
    [email, !revoke],
  );
  if (result.rowCount === 0) {
    console.error(`No existe una cuenta con el email ${email}. Registrala primero desde la app.`);
    process.exitCode = 1;
  } else {
    await client.query(
      'INSERT INTO "audit_logs" ("id", "userId", "action", "entityType", "entityId") VALUES (gen_random_uuid(), $1, $2, $3, $1)',
      [result.rows[0].id, revoke ? "admin.access.revoked" : "admin.access.granted", "user"],
    );
    console.log(revoke ? `Acceso a /admin quitado a ${email}.` : `Acceso a /admin otorgado a ${email}. Tiene que volver a ingresar.`);
  }
} finally {
  await client.end();
}
