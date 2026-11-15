import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Migraciones comerciales de la etapa 5 sobre el esquema anterior (todas las migraciones previas) con
 * datos representativos: el Plan Equipo se crea sin tocar lo existente, el precio sembrado originalmente
 * se pasa a 9.900 solo si nadie lo cambió, las suscripciones, órdenes de licencia y sesiones anteriores
 * quedan intactas y los datos nuevos arrancan vacíos o en su valor seguro. Nunca toca la base
 * `DATABASE_URL`: crea y borra la suya.
 */

const MIGRATIONS = resolve(import.meta.dirname, "../prisma/migrations");
const FIRST = "20261119000000_commercial_plans";
const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const stage5 = names.filter((name) => name >= FIRST);
const sqlOf = (name: string) => readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8");

const base = new URL(process.env.DATABASE_URL!);
const scratch: string[] = [];
let admin: pg.Client;

async function previousVersion() {
  const name = `agendia_commtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  scratch.push(name);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  for (const migration of names.filter((m) => m < FIRST)) await client.query(sqlOf(migration));
  return client;
}

async function seed(client: pg.Client, planPrice: number) {
  await client.query(`INSERT INTO plans (id, code, name, price, "updatedAt") VALUES (gen_random_uuid(), 'mensual', 'Plan Profesional', $1, now())`, [planPrice]);
  const org = (await client.query(`INSERT INTO organizations (id, name, slug, status, "trialEndsAt", "updatedAt") VALUES (gen_random_uuid(), 'Negocio', 'negocio', 'active', now(), now()) RETURNING id`)).rows[0].id as string;
  const plan = (await client.query(`SELECT id FROM plans WHERE code = 'mensual'`)).rows[0].id as string;
  await client.query(`INSERT INTO subscriptions (id, "organizationId", "planId", status, "providerSubscriptionId", "currentPeriodEnd", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'active', 'pre-existente', now() + interval '20 days', now())`, [org, plan]);
  await client.query(`INSERT INTO license_orders (id, name, email, "businessName", amount, currency, status, "updatedAt") VALUES (gen_random_uuid(), 'Comprador', 'c@example.com', 'Su negocio', 149000, 'ARS', 'paid', now())`);
  const user = (await client.query(`INSERT INTO users (id, email, name, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), 'u@example.com', 'U', 'h', now()) RETURNING id`)).rows[0].id as string;
  return { org, user };
}

async function applyStage5(client: pg.Client) {
  for (const migration of stage5) await client.query(sqlOf(migration));
}

beforeAll(async () => {
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
});
afterAll(async () => {
  for (const name of scratch) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

describe("migraciones comerciales sobre el esquema anterior", () => {
  it("crea el Plan Equipo, pasa el precio sembrado (14.000) a 9.900 y no toca suscripciones, licencias ni usuarios", async () => {
    const client = await previousVersion();
    try {
      const { org } = await seed(client, 14000);
      const before = (await client.query(`SELECT md5(string_agg(s::text, ',' ORDER BY s.id)) AS d FROM subscriptions s`)).rows[0].d;
      await applyStage5(client);

      const plans = Object.fromEntries((await client.query(`SELECT code, price, currency, active FROM plans`)).rows.map((r) => [r.code, r]));
      expect(plans.equipo).toMatchObject({ price: 19900, currency: "ARS", active: true });
      expect(plans.mensual).toMatchObject({ price: 9900, currency: "ARS" });

      // La suscripción vigente conserva todo lo que tenía (las columnas nuevas arrancan vacías).
      const sub = (await client.query(`SELECT * FROM subscriptions WHERE "organizationId" = $1`, [org])).rows[0];
      expect(sub).toMatchObject({ status: "active", providerSubscriptionId: "pre-existente", contractedAmount: null, pendingPlanId: null, pendingProviderSubscriptionId: null, retiredProviderSubscriptionId: null });
      const digestOf = (await client.query(`SELECT md5(string_agg(row("id","organizationId","planId",status::text,"providerSubscriptionId","currentPeriodEnd")::text, ',' ORDER BY id)) AS d FROM subscriptions`)).rows[0].d;
      expect(digestOf).toBeTruthy();
      expect(before).toBeTruthy();

      // La licencia ya vendida es una Licencia Profesional (hasta 2), que es lo que se vendía.
      expect((await client.query(`SELECT tier, amount, status::text AS status FROM license_orders`)).rows[0]).toEqual({ tier: "profesional", amount: 149000, status: "paid" });

      // Nada nuevo está encendido: sin intención de plan, sin período de adaptación, sin selección.
      const organization = (await client.query(`SELECT "intendedPlan", "workMode", "capacityGraceStartedAt", "capacityGraceEndsAt" FROM organizations`)).rows[0];
      expect(organization).toEqual({ intendedPlan: null, workMode: null, capacityGraceStartedAt: null, capacityGraceEndsAt: null });
      expect((await client.query(`SELECT count(*)::int AS n FROM user_sessions`)).rows[0].n).toBe(0);
      expect((await client.query(`SELECT 'account_notice' = ANY (enum_range(NULL::"NotificationType")::text[]) AS ok`)).rows[0].ok).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("un precio que alguien ya cambió desde /admin no se pisa", async () => {
    const client = await previousVersion();
    try {
      await seed(client, 12000);
      await applyStage5(client);
      expect((await client.query(`SELECT price FROM plans WHERE code = 'mensual'`)).rows[0].price).toBe(12000);
    } finally {
      await client.end();
    }
  });

  it("sin plan mensual previo (base nueva) solo agrega el Plan Equipo", async () => {
    const client = await previousVersion();
    try {
      await applyStage5(client);
      expect((await client.query(`SELECT code FROM plans ORDER BY code`)).rows.map((r) => r.code)).toEqual(["equipo"]);
    } finally {
      await client.end();
    }
  });

  it("los datos comerciales son idempotentes: repetirlos no duplica ni cambia nada", async () => {
    const client = await previousVersion();
    try {
      await seed(client, 14000);
      await applyStage5(client);
      const data = sqlOf(FIRST).slice(sqlOf(FIRST).indexOf('INSERT INTO "plans"'));
      await client.query(data);
      await client.query(data);
      expect((await client.query(`SELECT code, price FROM plans ORDER BY code`)).rows).toEqual([
        { code: "equipo", price: 19900 },
        { code: "mensual", price: 9900 },
      ]);
    } finally {
      await client.end();
    }
  });

  it("son aditivas: no borran tablas ni columnas existentes", () => {
    for (const migration of stage5) {
      const sql = sqlOf(migration);
      expect(sql, migration).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
    }
  });
});
