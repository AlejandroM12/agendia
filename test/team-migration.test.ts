import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import pg from "pg";
import { addDays, dateStrToDbDate, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { computeDaySlots } from "@/modules/availability/slots";

/**
 * Prueba de la migración `team_foundation` sobre una base de datos NUEVA que
 * reproduce el esquema anterior (todas las migraciones previas) con datos
 * representativos: se aplica la migración y se verifica que no se pierde ni
 * se altera nada, que los horarios quedan con el profesional original, que
 * los casos raros se manejan y que una inconsistencia aborta la migración
 * completa sin dejar nada a medias.
 *
 * Usa un servidor PostgreSQL con permisos para crear bases (el de desarrollo
 * y el de CI). Nunca toca la base `DATABASE_URL`: crea y borra la suya.
 */

const MIGRATIONS = resolve(import.meta.dirname, "../prisma/migrations");
const TEAM = "20261115010000_team_foundation";

function migrationFiles() {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
const sqlOf = (name: string) => readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8");

const base = new URL(process.env.DATABASE_URL!);
const adminUrl = (() => {
  const url = new URL(base);
  url.pathname = "/postgres";
  return url.toString();
})();

const scratch: string[] = [];
let admin: pg.Client;

async function newDatabaseAtPreviousVersion() {
  const name = `agendia_migtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  scratch.push(name);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  for (const migration of migrationFiles().filter((m) => m < TEAM)) await client.query(sqlOf(migration));
  return client;
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
});

afterAll(async () => {
  for (const name of scratch) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

/* ---------- datos representativos del esquema anterior ---------- */

type Ids = Record<string, string>;
const ids: Ids = {};
const id = (key: string) => (ids[key] ??= crypto.randomUUID());

async function seedOrganization(c: pg.Client, key: string, slug: string) {
  await c.query(
    `INSERT INTO organizations (id, name, slug, "trialEndsAt", "updatedAt", "onboardingCompletedAt") VALUES ($1, $2, $3, now() + interval '5 days', now(), now())`,
    [id(key), `Negocio ${key}`, slug],
  );
  await c.query(`INSERT INTO services (id, "organizationId", name, "durationMinutes", price, "updatedAt") VALUES ($1, $2, 'Servicio', 30, 1000, now())`, [id(`${key}-service`), id(key)]);
  await c.query(`INSERT INTO customers (id, "organizationId", name, "updatedAt") VALUES ($1, $2, 'Cliente', now())`, [id(`${key}-customer`), id(key)]);
}
async function seedProfessional(c: pg.Client, org: string, key: string, name: string, active: boolean, createdAt: string) {
  await c.query(`INSERT INTO professionals (id, "organizationId", "displayName", active, "createdAt") VALUES ($1, $2, $3, $4, $5)`, [id(key), id(org), name, active, createdAt]);
}
async function seedRules(c: pg.Client, org: string) {
  for (const [weekday, start, end] of [[1, 540, 780], [1, 840, 1080], [2, 540, 1080], [3, 540, 1080], [5, 600, 900]]) {
    await c.query(`INSERT INTO availability_rules (id, "organizationId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, $3, $4)`, [id(org), weekday, start, end]);
  }
}
async function seedAppointment(c: pg.Client, org: string, professionalKey: string, startsAt: Date, minutes: number, status: string, n: number) {
  await c.query(
    `INSERT INTO appointments (id, "organizationId", "professionalId", "serviceId", "customerId", "startsAt", "endsAt", status, "manageToken", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [id(org), id(professionalKey), id(`${org}-service`), id(`${org}-customer`), startsAt.toISOString(), new Date(startsAt.getTime() + minutes * 60000).toISOString(), status, `migtest-${org}-${n}-xxxxxxxxxxxxxxxx`],
  );
}

async function seedRepresentativeData(c: pg.Client) {
  const tz = "America/Argentina/Buenos_Aires";
  const today = todayInTz(tz);
  const at = (days: number, minutes: number) => zonedTimeToUtc(addDays(today, days), minutes, tz);

  // A: el caso normal. Un profesional, horarios, un bloqueo y turnos pasados, futuros y cancelados.
  await seedOrganization(c, "A", "negocio-a");
  await seedProfessional(c, "A", "A-pro", "Ana", true, "2026-01-01T10:00:00Z");
  await seedRules(c, "A");
  await c.query(`INSERT INTO availability_exceptions (id, "organizationId", date, reason) VALUES (gen_random_uuid(), $1, $2, 'Feriado')`, [id("A"), addDays(today, 4)]);
  await c.query(`INSERT INTO availability_exceptions (id, "organizationId", date, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, 720, 780)`, [id("A"), addDays(today, 6)]);
  await seedAppointment(c, "A", "A-pro", at(-3, 600), 30, "completed", 1);
  await seedAppointment(c, "A", "A-pro", at(2, 600), 30, "confirmed", 2);
  await seedAppointment(c, "A", "A-pro", at(2, 660), 60, "confirmed", 3);
  await seedAppointment(c, "A", "A-pro", at(3, 600), 30, "canceled", 4);

  // B: su único profesional está inactivo.
  await seedOrganization(c, "B", "negocio-b");
  await seedProfessional(c, "B", "B-pro", "Beto", false, "2026-02-01T10:00:00Z");
  await seedRules(c, "B");

  // C: nunca tuvo un profesional (tiene horarios y servicio).
  await seedOrganization(c, "C", "negocio-c");
  await seedRules(c, "C");

  // D: caso no esperado, dos profesionales activos con turnos cada uno (el más antiguo era el que usaba la app).
  await seedOrganization(c, "D", "negocio-d");
  await seedProfessional(c, "D", "D-old", "Diana (antigua)", true, "2026-01-01T10:00:00Z");
  await seedProfessional(c, "D", "D-new", "Darío (nuevo)", true, "2026-03-01T10:00:00Z");
  await seedRules(c, "D");
  await seedAppointment(c, "D", "D-old", at(2, 600), 30, "confirmed", 1);
  await seedAppointment(c, "D", "D-new", at(2, 600), 30, "confirmed", 2);

  // E: el más antiguo está inactivo y hay otro activo.
  await seedOrganization(c, "E", "negocio-e");
  await seedProfessional(c, "E", "E-old", "Elena (inactiva)", false, "2026-01-01T10:00:00Z");
  await seedProfessional(c, "E", "E-new", "Esteban (activo)", true, "2026-04-01T10:00:00Z");
  await seedRules(c, "E");

  // F: una cuenta recién creada, sin horarios ni nada.
  await seedOrganization(c, "F", "negocio-f");
  await seedProfessional(c, "F", "F-pro", "Fer", true, "2026-05-01T10:00:00Z");
}

/** Resumen verificable de lo que NO debe cambiar: huella de las columnas anteriores de cada tabla. */
async function legacyDigest(c: pg.Client) {
  const q = async (sql: string) => (await c.query(sql)).rows[0].digest as string | null;
  return {
    appointments: await q(`SELECT md5(coalesce(string_agg(concat_ws('|', id, "organizationId", "professionalId", "serviceId", "customerId", "startsAt", "endsAt", status, source, "manageToken", notes, price, "canceledAt", "canceledBy"), ';' ORDER BY id), '')) AS digest FROM appointments`),
    services: await q(`SELECT md5(coalesce(string_agg(concat_ws('|', id, "organizationId", name, description, "durationMinutes", price, active, "sortOrder"), ';' ORDER BY id), '')) AS digest FROM services`),
    customers: await q(`SELECT md5(coalesce(string_agg(concat_ws('|', id, "organizationId", name, email, phone, notes), ';' ORDER BY id), '')) AS digest FROM customers`),
    rules: await q(`SELECT md5(coalesce(string_agg(concat_ws('|', id, "organizationId", weekday, "startMinute", "endMinute"), ';' ORDER BY id), '')) AS digest FROM availability_rules`),
    exceptions: await q(`SELECT md5(coalesce(string_agg(concat_ws('|', id, "organizationId", date, "startMinute", "endMinute", reason), ';' ORDER BY id), '')) AS digest FROM availability_exceptions`),
    organizations: await q(`SELECT md5(coalesce(string_agg(concat_ws('|', id, name, slug, timezone, status, "trialEndsAt", "slotIntervalMinutes", "bufferMinutes", "minNoticeMinutes", "maxAdvanceDays", "themePrimary", "onboardingCompletedAt"), ';' ORDER BY id), '')) AS digest FROM organizations`),
  };
}

const count = async (c: pg.Client, table: string) => Number((await c.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

describe("migración team_foundation sobre una base anterior con datos representativos", () => {
  let c: pg.Client;
  let digestBefore: Awaited<ReturnType<typeof legacyDigest>>;
  let countsBefore: Record<string, number>;
  const slotsBefore: Record<string, number[]> = {};
  const tables = ["organizations", "services", "customers", "appointments", "availability_rules", "availability_exceptions"];

  /** Horarios de un negocio calculados con la función pura y los datos tal como están en la base. */
  async function slotsFor(client: pg.Client, org: string, perProfessional: boolean) {
    const tz = "America/Argentina/Buenos_Aires";
    const today = todayInTz(tz);
    const professionalId = perProfessional
      ? (await client.query(`SELECT id FROM professionals WHERE "organizationId" = $1 ORDER BY active DESC, "createdAt" ASC, id ASC LIMIT 1`, [id(org)])).rows[0]?.id
      : null;
    const rules = (await client.query(`SELECT weekday, "startMinute", "endMinute" FROM availability_rules WHERE "organizationId" = $1 ${perProfessional ? `AND "professionalId" = '${professionalId}'` : ""}`, [id(org)])).rows;
    const exceptions = (await client.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d, "startMinute", "endMinute" FROM availability_exceptions WHERE "organizationId" = $1`, [id(org)])).rows;
    const busy = (await client.query(`SELECT "startsAt", "endsAt" FROM appointments WHERE "organizationId" = $1 AND status <> 'canceled' ${perProfessional ? `AND "professionalId" = '${professionalId}'` : ""}`, [id(org)])).rows;
    const result: number[] = [];
    for (let i = 0; i < 20; i++) {
      const dateStr = addDays(today, i);
      for (const slot of computeDaySlots({
        dateStr, timeZone: tz, rules,
        exceptions: exceptions.filter((e) => e.d === dateStr),
        busy: busy.map((b) => ({ start: new Date(b.startsAt + "Z"), end: new Date(b.endsAt + "Z") })),
        durationMinutes: 30, slotIntervalMinutes: 30, bufferMinutes: 0,
        earliest: new Date(0), latest: new Date("2100-01-01"),
      })) result.push(slot.getTime());
    }
    return result;
  }

  beforeAll(async () => {
    c = await newDatabaseAtPreviousVersion();
    await seedRepresentativeData(c);
    digestBefore = await legacyDigest(c);
    countsBefore = {};
    for (const table of tables) countsBefore[table] = await count(c, table);
    // Horarios del negocio A y E antes de migrar, con el motor sin profesionales.
    for (const org of ["A", "B", "E", "F"]) slotsBefore[org] = await slotsFor(c, org, false);
    await c.query(sqlOf(TEAM));
  }, 60_000);

  afterAll(async () => {
    await c?.end();
  });

  it("no se pierde ni se altera ninguna fila existente", async () => {
    for (const table of tables.filter((t) => t !== "professionals")) {
      expect(await count(c, table), table).toBe(countsBefore[table]);
    }
    expect(await legacyDigest(c)).toEqual(digestBefore); // turnos, servicios, clientes, horarios, bloqueos y configuración, idénticos
  });

  it("los horarios pasan al profesional original de cada negocio; los bloqueos siguen siendo generales", async () => {
    const owner = async (org: string) => (await c.query(`SELECT DISTINCT "professionalId" FROM availability_rules WHERE "organizationId" = $1`, [id(org)])).rows;
    expect(await owner("A")).toEqual([{ professionalId: id("A-pro") }]);
    expect(await owner("B")).toEqual([{ professionalId: id("B-pro") }]); // único profesional, aunque esté inactivo
    expect(await owner("D")).toEqual([{ professionalId: id("D-old") }]); // el más antiguo: el que usaba la aplicación
    expect(await owner("E")).toEqual([{ professionalId: id("E-new") }]); // el activo, no el inactivo más antiguo
    const unassigned = await c.query(`SELECT count(*)::int AS n FROM availability_rules WHERE "professionalId" IS NULL`);
    expect(unassigned.rows[0].n).toBe(0);
    const exceptions = await c.query(`SELECT count(*)::int AS n FROM availability_exceptions WHERE "professionalId" IS NOT NULL`);
    expect(exceptions.rows[0].n).toBe(0);
  });

  it("un negocio sin profesional recibe uno (como habría creado la aplicación) y nadie queda sin profesional", async () => {
    const created = (await c.query(`SELECT "displayName", active, "sortOrder" FROM professionals WHERE "organizationId" = $1`, [id("C")])).rows;
    expect(created).toEqual([{ displayName: "Negocio C", active: true, sortOrder: 0 }]);
    const rules = (await c.query(`SELECT DISTINCT "professionalId" FROM availability_rules WHERE "organizationId" = $1`, [id("C")])).rows;
    expect(rules).toHaveLength(1);
    const empty = await c.query(`SELECT count(*)::int AS n FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM professionals p WHERE p."organizationId" = o.id)`);
    expect(empty.rows[0].n).toBe(0);
  });

  it("los profesionales conservan nombre y estado, y reciben orden y valores por defecto", async () => {
    const d = (await c.query(`SELECT "displayName", active, "sortOrder", "bookableOnline", color, "userId", "photoImageId" FROM professionals WHERE "organizationId" = $1 ORDER BY "sortOrder"`, [id("D")])).rows;
    expect(d).toEqual([
      { displayName: "Diana (antigua)", active: true, sortOrder: 0, bookableOnline: true, color: "#1f4d3f", userId: null, photoImageId: null },
      { displayName: "Darío (nuevo)", active: true, sortOrder: 1, bookableOnline: true, color: "#1f4d3f", userId: null, photoImageId: null },
    ]);
    const e = (await c.query(`SELECT "displayName", active FROM professionals WHERE "organizationId" = $1 ORDER BY "sortOrder"`, [id("E")])).rows;
    expect(e).toEqual([{ displayName: "Elena (inactiva)", active: false }, { displayName: "Esteban (activo)", active: true }]);
  });

  it("los turnos existentes quedan «específicos», sin pedido del cliente, y la configuración nueva apagada", async () => {
    const appointments = (await c.query(`SELECT DISTINCT "professionalSelection", "requestedProfessionalId", "idempotencyKey" FROM appointments`)).rows;
    expect(appointments).toEqual([{ professionalSelection: "specific", requestedProfessionalId: null, idempotencyKey: null }]);
    const orgs = (await c.query(`SELECT DISTINCT "teamModeEnabled", "extraProfessionals" FROM organizations`)).rows;
    expect(orgs).toEqual([{ teamModeEnabled: false, extraProfessionals: 0 }]);
    const services = (await c.query(`SELECT DISTINCT "allProfessionals" FROM services`)).rows;
    expect(services).toEqual([{ allProfessionals: true }]);
  });

  it("los negocios individuales obtienen exactamente los mismos horarios disponibles que antes", async () => {
    for (const org of ["A", "B", "E", "F"]) {
      expect(await slotsFor(c, org, true), `negocio ${org}`).toEqual(slotsBefore[org]);
    }
    expect(slotsBefore.A.length).toBeGreaterThan(20); // el escenario no es trivial
  });

  it("los casos con más de un profesional se detectan para revisarlos (negocios D y E)", async () => {
    const several = (await c.query(`SELECT o.slug FROM professionals p JOIN organizations o ON o.id = p."organizationId" GROUP BY o.slug HAVING count(*) > 1 ORDER BY o.slug`)).rows.map((r) => r.slug);
    expect(several).toEqual(["negocio-d", "negocio-e"]);
  });

  it("la restricción anti-superposición sigue valiendo por profesional: dos profesionales a la vez, el mismo no", async () => {
    const day = addDays(todayInTz("America/Argentina/Buenos_Aires"), 9);
    const startsAt = zonedTimeToUtc(day, 600, "America/Argentina/Buenos_Aires");
    // D tiene dos profesionales con turnos a la misma hora (ya cargados antes de migrar): conviven.
    const simultaneous = await c.query(`SELECT count(DISTINCT "professionalId")::int AS n FROM appointments WHERE "organizationId" = $1 AND status = 'confirmed' GROUP BY "startsAt" HAVING count(*) > 1`, [id("D")]);
    expect(simultaneous.rows[0].n).toBe(2);
    await seedAppointment(c, "A", "A-pro", startsAt, 30, "confirmed", 90);
    await expect(seedAppointment(c, "A", "A-pro", startsAt, 30, "confirmed", 91)).rejects.toThrow(/appointments_no_overlap/);
  });

  it("las claves foráneas compuestas impiden mezclar organizaciones y el historial no se puede borrar", async () => {
    await expect(
      c.query(`INSERT INTO availability_rules (id, "organizationId", "professionalId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, 1, 0, 60)`, [id("A"), id("F-pro")]),
    ).rejects.toThrow(/violates foreign key/);
    await expect(
      c.query(`INSERT INTO service_professionals ("organizationId", "serviceId", "professionalId") VALUES ($1, $2, $3)`, [id("A"), id("A-service"), id("F-pro")]),
    ).rejects.toThrow(/violates foreign key/);
    await expect(c.query(`DELETE FROM professionals WHERE id = $1`, [id("A-pro")])).rejects.toThrow(/violates foreign key/);
  });

  it("compatibilidad con la versión anterior: un horario insertado sin profesional lo completa la base", async () => {
    await c.query(`INSERT INTO availability_rules (id, "organizationId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, 6, 540, 600)`, [id("D")]);
    const row = (await c.query(`SELECT "professionalId" FROM availability_rules WHERE "organizationId" = $1 AND weekday = 6`, [id("D")])).rows[0];
    expect(row.professionalId).toBe(id("D-old"));
  });
});

describe("migración con datos inconsistentes", () => {
  it("un turno con el profesional de OTRA organización aborta toda la migración sin dejar nada a medias", async () => {
    const c = await newDatabaseAtPreviousVersion();
    try {
      await seedOrganization(c, "X", "negocio-x");
      await seedOrganization(c, "Y", "negocio-y");
      await seedProfessional(c, "X", "X-pro", "Xavier", true, "2026-01-01T10:00:00Z");
      await seedProfessional(c, "Y", "Y-pro", "Yamila", true, "2026-01-01T10:00:00Z");
      await seedRules(c, "X");
      // La clave foránea anterior no lo impedía: el turno de X apunta al profesional de Y.
      await seedAppointment(c, "X", "Y-pro", new Date(Date.now() + 86400000 * 3), 30, "confirmed", 1);
      const before = await legacyDigest(c);

      await expect(c.query(sqlOf(TEAM))).rejects.toThrow(/apuntan a un profesional de otra organización/);

      // Nada cambió: ni columnas nuevas, ni tipos, ni datos.
      expect((await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'availability_rules' AND column_name = 'professionalId'`)).rows[0].n).toBe(0);
      expect((await c.query(`SELECT count(*)::int AS n FROM pg_type WHERE typname = 'ProfessionalSelection'`)).rows[0].n).toBe(0);
      expect(await legacyDigest(c)).toEqual(before);
    } finally {
      await c.end();
    }
  });
});

describe("las claves de fechas de los bloqueos siguen siendo las mismas", () => {
  it("dateStrToDbDate no cambió (los bloqueos conservan su comportamiento)", () => {
    expect(dateStrToDbDate("2026-11-20").toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
});
