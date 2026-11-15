import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Migración `accounts_and_invitations` sobre una base NUEVA con el esquema
 * anterior (todas las migraciones previas) y datos representativos: se aplica
 * y se verifica que los propietarios conservan su acceso, que no se pierde ni
 * se altera nada, que una persona puede ser profesional en varios negocios y
 * que una inconsistencia previa aborta la migración sin dejar nada a medias.
 * Nunca toca la base `DATABASE_URL`: crea y borra la suya.
 */

const MIGRATIONS = resolve(import.meta.dirname, "../prisma/migrations");
const TARGET = "20261118000000_accounts_and_invitations";
const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const sqlOf = (name: string) => readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8");

const base = new URL(process.env.DATABASE_URL!);
const adminUrl = (() => {
  const url = new URL(base);
  url.pathname = "/postgres";
  return url.toString();
})();
const scratch: string[] = [];
let admin: pg.Client;

async function previousVersion() {
  const name = `agendia_acctest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  scratch.push(name);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  for (const migration of names.filter((m) => m < TARGET)) await client.query(sqlOf(migration));
  return client;
}

async function seed(client: pg.Client) {
  const org = async (slug: string) =>
    (await client.query(`INSERT INTO organizations (id, name, slug, "trialEndsAt", "updatedAt") VALUES (gen_random_uuid(), $1, $1, now() + interval '14 days', now()) RETURNING id`, [slug])).rows[0].id as string;
  const user = async (email: string) =>
    (await client.query(`INSERT INTO users (id, email, name, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (gen_random_uuid(), $1, $1, 'hash-' || $1, now(), now()) RETURNING id`, [email])).rows[0].id as string;
  const a = await org("negocio-a");
  const b = await org("negocio-b");
  const ana = await user("ana@example.com");
  const beto = await user("beto@example.com");
  await client.query(`INSERT INTO memberships (id, "organizationId", "userId", role) VALUES (gen_random_uuid(), $1, $2, 'owner'), (gen_random_uuid(), $3, $4, 'owner'), (gen_random_uuid(), $1, $4, 'admin')`, [a, ana, b, beto]);
  const pro = async (orgId: string, name: string, userId: string | null) =>
    (await client.query(`INSERT INTO professionals (id, "organizationId", "displayName", "userId", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id`, [orgId, name, userId])).rows[0].id as string;
  const proA = await pro(a, "Ana", ana);
  const proB = await pro(b, "Beto", beto);
  await client.query(`INSERT INTO services (id, "organizationId", name, "durationMinutes", "updatedAt") VALUES (gen_random_uuid(), $1, 'Consulta', 30, now())`, [a]);
  return { a, b, ana, beto, proA, proB };
}

const digest = async (client: pg.Client) =>
  (await client.query(`SELECT
    (SELECT md5(string_agg(id || "organizationId" || "userId" || role::text, ',' ORDER BY id)) FROM memberships) AS memberships,
    (SELECT md5(string_agg(id || "displayName" || coalesce("userId", ''), ',' ORDER BY id)) FROM professionals) AS professionals,
    (SELECT md5(string_agg(id || email || "passwordHash", ',' ORDER BY id)) FROM users) AS users,
    (SELECT md5(string_agg(id || name, ',' ORDER BY id)) FROM organizations) AS organizations,
    (SELECT md5(string_agg(id || name, ',' ORDER BY id)) FROM services) AS services`)).rows[0];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
});

afterAll(async () => {
  for (const name of scratch) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

describe("migración de cuentas individuales sobre el esquema anterior", () => {
  it("conserva usuarios, contraseñas, membresías, roles, profesionales y servicios; los propietarios siguen entrando", async () => {
    const client = await previousVersion();
    try {
      const ids = await seed(client);
      const before = await digest(client);
      await client.query(sqlOf(TARGET));
      expect(await digest(client)).toEqual(before);

      const owners = await client.query(`SELECT "userId", "organizationId", role::text AS role, "notifyBookings" FROM memberships WHERE role = 'owner' ORDER BY "organizationId"`);
      expect(owners.rows).toHaveLength(2);
      expect(owners.rows.every((r) => r.notifyBookings === true)).toBe(true); // siguen recibiendo avisos, como antes
      expect(owners.rows.map((r) => r.userId).sort()).toEqual([ids.ana, ids.beto].sort());

      const org = (await client.query(`SELECT "teamAccountsEnabled", "professionalPermissions" FROM organizations LIMIT 1`)).rows[0];
      expect(org).toEqual({ teamAccountsEnabled: false, professionalPermissions: null }); // apagado por defecto
      expect((await client.query(`SELECT count(*)::int AS n FROM invitations`)).rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("después de migrar, una persona puede ser profesional en varios negocios, pero una sola vez en cada uno", async () => {
    const client = await previousVersion();
    try {
      const ids = await seed(client);
      await client.query(sqlOf(TARGET));
      // Beto ya es miembro (admin) del negocio A: puede vincularse como profesional allí además de su perfil en B.
      const second = (await client.query(`INSERT INTO professionals (id, "organizationId", "displayName", "updatedAt") VALUES (gen_random_uuid(), $1, 'Beto en A', now()) RETURNING id`, [ids.a])).rows[0].id;
      await client.query(`UPDATE professionals SET "userId" = $1 WHERE id = $2`, [ids.beto, second]);
      expect((await client.query(`SELECT count(*)::int AS n FROM professionals WHERE "userId" = $1`, [ids.beto])).rows[0].n).toBe(2);
      // Pero no dos perfiles de la misma persona en el mismo negocio.
      const third = (await client.query(`INSERT INTO professionals (id, "organizationId", "displayName", "updatedAt") VALUES (gen_random_uuid(), $1, 'Otra en A', now()) RETURNING id`, [ids.a])).rows[0].id;
      await expect(client.query(`UPDATE professionals SET "userId" = $1 WHERE id = $2`, [ids.beto, third])).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it("los triggers de integridad: solo miembros del negocio, y soltar al profesional al perder la membresía", async () => {
    const client = await previousVersion();
    try {
      const ids = await seed(client);
      await client.query(sqlOf(TARGET));
      const stranger = (await client.query(`INSERT INTO users (id, email, name, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), 'x@example.com', 'x', 'h', now()) RETURNING id`)).rows[0].id;
      await expect(client.query(`UPDATE professionals SET "userId" = $1 WHERE id = $2`, [stranger, ids.proA])).rejects.toThrow(/miembro/);
      // Un profesional nuevo tampoco se puede crear vinculado a un no miembro.
      await expect(client.query(`INSERT INTO professionals (id, "organizationId", "displayName", "userId", "updatedAt") VALUES (gen_random_uuid(), $1, 'Z', $2, now())`, [ids.a, stranger])).rejects.toThrow();

      await client.query(`DELETE FROM memberships WHERE "organizationId" = $1 AND "userId" = $2`, [ids.a, ids.ana]);
      const released = (await client.query(`SELECT "userId", "displayName", active FROM professionals WHERE id = $1`, [ids.proA])).rows[0];
      expect(released).toEqual({ userId: null, displayName: "Ana", active: true }); // el perfil se conserva
    } finally {
      await client.end();
    }
  });

  it("una invitación debe ser coherente: profesional con perfil, administrador sin perfil, nunca propietario; una pendiente por perfil", async () => {
    const client = await previousVersion();
    try {
      const ids = await seed(client);
      await client.query(sqlOf(TARGET));
      const insert = (role: string, professionalId: string | null, email: string, status = "pending") =>
        client.query(`INSERT INTO invitations (id, "organizationId", "professionalId", email, role, "tokenHash", status, "expiresAt") VALUES (gen_random_uuid(), $1, $2, $3, $4::"MembershipRole", gen_random_uuid()::text, $5::"InvitationStatus", now() + interval '7 days')`, [ids.a, professionalId, email, role, status]);
      await expect(insert("professional", null, "a@x.com")).rejects.toThrow();
      await expect(insert("admin", ids.proA, "b@x.com")).rejects.toThrow();
      await expect(insert("owner", null, "c@x.com")).rejects.toThrow();
      await insert("professional", ids.proA, "d@x.com", "revoked");
      await insert("professional", ids.proA, "e@x.com");
      await expect(insert("professional", ids.proA, "f@x.com")).rejects.toThrow(); // dos pendientes del mismo perfil
      await insert("admin", null, "g@x.com");
      await expect(insert("admin", null, "g@x.com")).rejects.toThrow(); // dos pendientes del mismo correo
      // Un profesional de otro negocio no se puede invitar desde este (clave foránea compuesta).
      await expect(
        client.query(`INSERT INTO invitations (id, "organizationId", "professionalId", email, role, "tokenHash", "expiresAt") VALUES (gen_random_uuid(), $1, $2, 'h@x.com', 'professional', 'tok', now() + interval '1 day')`, [ids.a, ids.proB]),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it("aborta sin cambiar nada si había un profesional vinculado a una cuenta que no es miembro de su negocio", async () => {
    const client = await previousVersion();
    try {
      const ids = await seed(client);
      await client.query(`DELETE FROM memberships WHERE "organizationId" = $1 AND "userId" = $2`, [ids.a, ids.ana]); // el esquema anterior lo permitía
      const before = await digest(client);
      await expect(client.query(sqlOf(TARGET))).rejects.toThrow(/no es miembro de su negocio/);
      expect(await digest(client)).toEqual(before);
      expect((await client.query(`SELECT to_regclass('invitations') AS t`)).rows[0].t).toBeNull(); // nada quedó a medias
      expect((await client.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'memberships' AND column_name = 'notifyBookings'`)).rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });
});
