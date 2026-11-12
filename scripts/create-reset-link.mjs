// Genera un enlace de recuperación de contraseña para una cuenta (soporte).
//
//   npm run support:reset-link -- usuario@email.com
//
// En producción:
//   docker compose --env-file .env.production run --rm migrate \
//     node scripts/create-reset-link.mjs usuario@email.com
//
// Es el camino de respaldo cuando un usuario no recibe el email de
// recuperación: el enlace vale una hora y un solo uso, igual que el
// automático. Enviarlo únicamente a un contacto verificado del titular de la
// cuenta. Guarda en la base solo el hash del token, y deja registro en
// audit_logs.

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.DATABASE_URL) {
  console.error("Uso: node scripts/create-reset-link.mjs <email>   (requiere DATABASE_URL)");
  process.exit(1);
}

const baseUrl = (process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const user = await client.query('SELECT "id" FROM "users" WHERE "email" = $1', [email]);
  if (user.rowCount === 0) {
    console.error(`No existe una cuenta con el email ${email}.`);
    process.exitCode = 1;
  } else {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await client.query(
      `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt")
       VALUES (gen_random_uuid(), $1, $2, now() + interval '1 hour')`,
      [user.rows[0].id, tokenHash],
    );
    await client.query(
      'INSERT INTO "audit_logs" ("id", "userId", "action", "entityType", "entityId") VALUES (gen_random_uuid(), $1, $2, $3, $1)',
      [user.rows[0].id, "support.password_reset_link_created", "user"],
    );
    console.log(`Enlace válido por 1 hora (un solo uso):\n${baseUrl}/restablecer-contrasena/${token}`);
  }
} finally {
  await client.end();
}
