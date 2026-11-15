// Prepara la base para volver a una versión anterior de la aplicación SIN perder datos.
//
//   node scripts/prepare-rollback.mjs            informa qué habría que mover (no modifica nada)
//   node scripts/prepare-rollback.mjs --apply    hace una copia y deja la base compatible
//   node scripts/prepare-rollback.mjs --restore  vuelve a poner lo copiado (al volver a la versión nueva)
//
// Por qué hace falta: las versiones anteriores no conocen tres valores nuevos de
// enum (`OrganizationImageKind.professional`, `NotificationType.professional_change` y
// `NotificationType.account_notice`)
// y fallan al leer una fila que los tenga. Los valores de enum no se pueden quitar,
// así que las filas se APARTAN, no se borran:
//
//  1. Las fotos de profesionales se copian a `rollback_backup_professional_images`
//     y se sacan de `organization_images` (el profesional queda sin foto; nada más cambia).
//  3. (Etapa 4) Los accesos que NO son del propietario -los de profesionales y de
//     administradores invitados- se copian a `rollback_backup_memberships` y se quitan
//     de `memberships`. La version anterior no conoce el rol `professional` y, ademas,
//     trataria a cualquier administrador como propietario (no tenia roles): dejarlos
//     seria dar acceso total a quien no lo tiene. Los profesionales conservan su
//     perfil, su agenda y sus turnos; solo pierden la cuenta, y `--restore` la devuelve.
//  2. Los avisos `professional_change` y `account_notice` (los de la cuenta al propietario:
//     fin de prueba, exceso de cupo) se copian a `rollback_backup_notifications`; los
//     pendientes se anulan y el tipo de todos pasa a `reschedule` (el historial se conserva,
//     con el tipo más parecido que conoce la versión anterior; sin turno, la versión anterior
//     los descarta al procesarlos). `--restore` devuelve cada uno a su tipo original.
//  4. (Etapa 5) Las sesiones revocadas (`user_sessions.revokedAt`) dejarían de estar revocadas:
//     la versión anterior no consulta esa tabla. Para que una sesión cerrada no reviva, a esas
//     personas se les sube `sessionVersion` (se les cierran todas las sesiones y vuelven a
//     ingresar). No hay nada que restaurar.
//     Lo demás de la etapa 5 es aditivo y la versión anterior lo ignora: columnas de suscripción
//     (cambio de plan pendiente, importe contratado), período de adaptación, `keepBookable`,
//     `workMode`, `intendedPlan`, nivel de licencia. Un negocio con Plan Equipo conserva su
//     cupo de 5 en las versiones que ya conocían ese plan; las anteriores no limitan cupos.
//
// Todo ocurre en UNA transacción: si algo falla, no cambia nada. `--restore` revierte
// ambos pasos. Antes de usarlo en producción: copia de seguridad completa (deploy/backup.sh).

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const PHOTO_BACKUP = "rollback_backup_professional_images";
const NOTICE_BACKUP = "rollback_backup_notifications";
const MEMBERSHIP_BACKUP = "rollback_backup_memberships";

/** Cuántas filas habría que mover. Solo lectura. */
export async function inspect(client) {
  const photos = await client.query(`SELECT count(*)::int AS n FROM "organization_images" WHERE "kind"::text = 'professional'`);
  const notices = await client.query(`SELECT count(*)::int AS n FROM "notifications" WHERE "type"::text IN ('professional_change', 'account_notice')`);
  const members = await client.query(`SELECT count(*)::int AS n FROM "memberships" WHERE "role"::text <> 'owner'`);
  const sessions = await client.query(
    `SELECT count(DISTINCT "userId")::int AS n FROM "user_sessions" WHERE "revokedAt" IS NOT NULL AND "userId" IN (SELECT "id" FROM "users")`,
  ).catch(() => ({ rows: [{ n: 0 }] })); // la tabla no existe en una base anterior a la etapa 5
  return { photos: photos.rows[0].n, notices: notices.rows[0].n, members: members.rows[0].n, sessionUsers: sessions.rows[0].n };
}

export async function apply(client) {
  await client.query("BEGIN");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "${PHOTO_BACKUP}" (LIKE "organization_images" INCLUDING DEFAULTS)`);
    await client.query(`ALTER TABLE "${PHOTO_BACKUP}" ALTER COLUMN "kind" TYPE text USING "kind"::text`);
    await client.query(`CREATE TABLE IF NOT EXISTS "${NOTICE_BACKUP}" (LIKE "notifications" INCLUDING DEFAULTS)`);
    await client.query(`ALTER TABLE "${NOTICE_BACKUP}" ALTER COLUMN "type" TYPE text USING "type"::text`);
    await client.query(`ALTER TABLE "${NOTICE_BACKUP}" ALTER COLUMN "status" TYPE text USING "status"::text`);
    await client.query(`ALTER TABLE "${NOTICE_BACKUP}" ALTER COLUMN "channel" TYPE text USING "channel"::text`);

    // Qué profesional usaba cada foto, para poder restaurarla.
    await client.query(`ALTER TABLE "${PHOTO_BACKUP}" ADD COLUMN IF NOT EXISTS "professionalId" text`);
    await client.query(
      `INSERT INTO "${PHOTO_BACKUP}" ("id","organizationId","kind","contentType","width","height","bytes","createdAt","professionalId")
       SELECT i."id", i."organizationId", i."kind"::text, i."contentType", i."width", i."height", i."bytes", i."createdAt", p."id"
       FROM "organization_images" i LEFT JOIN "professionals" p ON p."photoImageId" = i."id"
       WHERE i."kind"::text = 'professional' AND NOT EXISTS (SELECT 1 FROM "${PHOTO_BACKUP}" b WHERE b."id" = i."id")`,
    );
    // La clave foránea es ON DELETE SET NULL: los profesionales quedan sin foto, sin más cambios.
    const photos = await client.query(`DELETE FROM "organization_images" WHERE "kind"::text = 'professional'`);

    await client.query(
      `INSERT INTO "${NOTICE_BACKUP}" ("id","organizationId","appointmentId","type","channel","recipient","scheduledFor","status","attempts","lastError","sentAt","idempotencyKey","lockedUntil","payload","createdAt")
       SELECT n."id", n."organizationId", n."appointmentId", n."type"::text, n."channel"::text, n."recipient",
         n."scheduledFor", n."status"::text, n."attempts", n."lastError", n."sentAt", n."idempotencyKey", n."lockedUntil", n."payload", n."createdAt"
       FROM "notifications" n WHERE n."type"::text IN ('professional_change', 'account_notice') AND NOT EXISTS (SELECT 1 FROM "${NOTICE_BACKUP}" b WHERE b."id" = n."id")`,
    );
    await client.query(`UPDATE "notifications" SET "status" = 'canceled' WHERE "type"::text IN ('professional_change', 'account_notice') AND "status" = 'pending'`);
    const notices = await client.query(`UPDATE "notifications" SET "type" = 'reschedule' WHERE "type"::text IN ('professional_change', 'account_notice')`);

    // Accesos que no son del propietario (ver arriba), con el perfil al que estaban vinculados.
    await client.query(`CREATE TABLE IF NOT EXISTS "${MEMBERSHIP_BACKUP}" (LIKE "memberships" INCLUDING DEFAULTS)`);
    await client.query(`ALTER TABLE "${MEMBERSHIP_BACKUP}" ALTER COLUMN "role" TYPE text USING "role"::text`);
    await client.query(`ALTER TABLE "${MEMBERSHIP_BACKUP}" ADD COLUMN IF NOT EXISTS "professionalId" text`);
    await client.query(
      `INSERT INTO "${MEMBERSHIP_BACKUP}" ("id","organizationId","userId","role","createdAt","notifyBookings","professionalId")
       SELECT m."id", m."organizationId", m."userId", m."role"::text, m."createdAt", m."notifyBookings", p."id"
       FROM "memberships" m LEFT JOIN "professionals" p ON p."organizationId" = m."organizationId" AND p."userId" = m."userId"
       WHERE m."role"::text <> 'owner' AND NOT EXISTS (SELECT 1 FROM "${MEMBERSHIP_BACKUP}" b WHERE b."id" = m."id")`,
    );
    const members = await client.query(`DELETE FROM "memberships" WHERE "role"::text <> 'owner'`);

    // Sesiones revocadas: se cierran todas las de esas personas (ver 4).
    let sessions = 0;
    if ((await client.query(`SELECT to_regclass('"user_sessions"') AS t`)).rows[0].t) {
      sessions = (
        await client.query(
          `UPDATE "users" SET "sessionVersion" = "sessionVersion" + 1 WHERE "id" IN (SELECT DISTINCT "userId" FROM "user_sessions" WHERE "revokedAt" IS NOT NULL)`,
        )
      ).rowCount;
    }

    await client.query("COMMIT");
    return { photosMoved: photos.rowCount, noticesConverted: notices.rowCount, membersMoved: members.rowCount, sessionsInvalidatedFor: sessions };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function restore(client) {
  await client.query("BEGIN");
  try {
    const hasPhotos = (await client.query(`SELECT to_regclass('"${PHOTO_BACKUP}"') AS t`)).rows[0].t;
    const hasNotices = (await client.query(`SELECT to_regclass('"${NOTICE_BACKUP}"') AS t`)).rows[0].t;
    let photos = 0;
    let notices = 0;
    if (hasPhotos) {
      await client.query(
        `INSERT INTO "organization_images" ("id","organizationId","kind","contentType","width","height","bytes","createdAt")
         SELECT b."id",b."organizationId",b."kind"::"OrganizationImageKind",b."contentType",b."width",b."height",b."bytes",b."createdAt" FROM "${PHOTO_BACKUP}" b
         WHERE NOT EXISTS (SELECT 1 FROM "organization_images" i WHERE i."id" = b."id")`,
      );
      photos = (
        await client.query(
          `UPDATE "professionals" p SET "photoImageId" = b."id" FROM "${PHOTO_BACKUP}" b WHERE b."professionalId" = p."id" AND p."photoImageId" IS NULL`,
        )
      ).rowCount;
    }
    if (hasNotices) {
      notices = (
        await client.query(
          `UPDATE "notifications" n SET "type" = b."type"::"NotificationType", "status" = b."status"::"NotificationStatus"
           FROM "${NOTICE_BACKUP}" b WHERE b."id" = n."id"`,
        )
      ).rowCount;
    }
    let members = 0;
    const hasMembers = (await client.query(`SELECT to_regclass('"${MEMBERSHIP_BACKUP}"') AS t`)).rows[0].t;
    if (hasMembers) {
      members = (
        await client.query(
          `INSERT INTO "memberships" ("id","organizationId","userId","role","createdAt","notifyBookings")
           SELECT b."id", b."organizationId", b."userId", b."role"::"MembershipRole", b."createdAt", b."notifyBookings" FROM "${MEMBERSHIP_BACKUP}" b
           WHERE NOT EXISTS (SELECT 1 FROM "memberships" m WHERE m."organizationId" = b."organizationId" AND m."userId" = b."userId")
             AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = b."userId") AND EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = b."organizationId")`,
        )
      ).rowCount;
      await client.query(
        `UPDATE "professionals" p SET "userId" = b."userId" FROM "${MEMBERSHIP_BACKUP}" b
         WHERE b."professionalId" = p."id" AND p."userId" IS NULL AND b."role" = 'professional'
           AND EXISTS (SELECT 1 FROM "memberships" m WHERE m."organizationId" = p."organizationId" AND m."userId" = b."userId")`,
      );
    }
    await client.query("COMMIT");
    return { photosRestored: photos, noticesRestored: notices, membersRestored: members };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
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
  try {
    const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--restore") ? "restore" : "inspect";
    if (mode === "inspect") {
      const found = await inspect(client);
      console.log(`Fotos de profesionales: ${found.photos}`);
      console.log(`Avisos de cambio de profesional: ${found.notices}`);
      console.log(`Accesos de profesionales y administradores: ${found.members}`);
      console.log(`Personas con sesiones revocadas (se les cierran todas las sesiones): ${found.sessionUsers}`);
      console.log(found.photos + found.notices + found.members + found.sessionUsers === 0 ? "Nada que mover: la base ya es compatible con la versión anterior." : "Para apartarlos sin borrar nada: node scripts/prepare-rollback.mjs --apply");
    } else if (mode === "apply") {
      console.log(await apply(client));
    } else {
      console.log(await restore(client));
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
