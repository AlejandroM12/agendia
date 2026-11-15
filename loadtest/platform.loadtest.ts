import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next/navigation", () => ({ redirect: () => undefined, notFound: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { listWorkspaces } from "@/lib/dal";
import { createAppointment } from "@/modules/appointments/service";
import { getTeamAvailability } from "@/modules/availability/queries";
import { processDueNotifications } from "@/modules/notifications/process";
import { appointmentScope, customerScope } from "@/modules/access/scope";
import { listPublicTeam } from "@/modules/team/eligibility";

/**
 * Prueba de carga LOCAL. Corre en una base descartable, en esta máquina, sin red ni servicios externos
 * (el envío de correos está reemplazado por una función instantánea). Mide la lógica y las consultas de la
 * aplicación contra PostgreSQL real; NO mide el servidor web, la red, TLS ni el VPS de producción, así que
 * los números no se pueden trasladar a producción: sirven para detectar consultas lentas y problemas de
 * concurrencia y para comparar antes/después de un cambio. Imprime un resumen y lo guarda en
 * test-results/loadtest-local.json.
 */

const ORGS = Number(process.env.LOADTEST_ORGS ?? 100);
const TZ = "America/Argentina/Buenos_Aires";
const results: Record<string, unknown> = {};

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1) };
}
async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = performance.now();
  const value = await fn();
  return [performance.now() - start, value];
}
/** Corre `total` tareas con `concurrency` a la vez; devuelve las duraciones en ms. */
async function pool<T>(total: number, concurrency: number, task: (index: number) => Promise<T>) {
  const durations: number[] = [];
  const values: T[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const index = next++;
        const [ms, value] = await timed(() => task(index));
        durations.push(ms);
        values.push(value);
      }
    }),
  );
  return { durations, values, seconds: (performance.now() - started) / 1000 };
}

type Seeded = { id: string; proIds: string[]; serviceId: string; ownerId: string; email: string };
const seeded: Seeded[] = [];
let peakRss = 0;
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 200);

describe("carga local", () => {
  it("siembra el escenario", async () => {
    const [ms] = await timed(async () => {
      const passwordHash = await hashPassword("Contrasena123");
      const today = todayInTz(TZ);
      for (let i = 0; i < ORGS; i++) {
        // 60 % solos, 30 % con 2–3 profesionales, 10 % con 5.
        const pros = i % 10 === 0 ? 5 : i % 10 < 4 ? 2 + (i % 2) : 1;
        const org = await db.organization.create({
          data: {
            name: `Carga ${i}`,
            slug: `carga-${i}-${randomBytes(3).toString("hex")}`,
            trialEndsAt: new Date(Date.now() + 14 * 86400000),
            onboardingCompletedAt: new Date(),
            minNoticeMinutes: 0,
            teamModeEnabled: pros > 1,
            teamAccountsEnabled: pros > 1,
          },
        });
        const user = await db.user.create({ data: { email: `carga${i}-${randomBytes(3).toString("hex")}@example.com`, name: `Dueño ${i}`, passwordHash, emailVerifiedAt: new Date() } });
        await db.membership.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
        const proIds: string[] = [];
        for (let p = 0; p < pros; p++) {
          const pro = await db.professional.create({ data: { organizationId: org.id, displayName: `Prof ${i}-${p}`, sortOrder: p } });
          proIds.push(pro.id);
          await db.availabilityRule.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ organizationId: org.id, professionalId: pro.id, weekday, startMinute: 540, endMinute: 1080 })) });
        }
        const service = await db.service.create({ data: { organizationId: org.id, name: "Consulta", durationMinutes: 30, price: 10000 } });
        const customers = await db.customer.createManyAndReturn({
          data: Array.from({ length: 60 }, (_, c) => ({ organizationId: org.id, name: `Cliente ${c}`, email: `c${c}@example.com`, phone: `1155${String(100000 + c)}` })),
        });
        // ~150 turnos futuros repartidos entre los profesionales, sin superponerse.
        const rows = [];
        for (let a = 0; a < 150; a++) {
          const pro = proIds[a % proIds.length];
          const day = addDays(today, 1 + Math.floor(a / (proIds.length * 14)));
          const minute = 540 + (Math.floor(a / proIds.length) % 14) * 30;
          const startsAt = zonedTimeToUtc(day, minute, TZ);
          rows.push({
            organizationId: org.id, professionalId: pro, serviceId: service.id, customerId: customers[a % customers.length].id,
            startsAt, endsAt: new Date(startsAt.getTime() + 1800000), manageToken: randomBytes(12).toString("hex"),
          });
        }
        await db.appointment.createMany({ data: rows, skipDuplicates: true });
        seeded.push({ id: org.id, proIds, serviceId: service.id, ownerId: user.id, email: user.email });
      }
    });
    results.seedSeconds = +(ms / 1000).toFixed(1);
    results.scenario = { businesses: ORGS, appointments: await db.appointment.count(), professionals: await db.professional.count(), customers: await db.customer.count() };
    expect(seeded).toHaveLength(ORGS);
  });

  it("consultas de disponibilidad (7 días) y equipo público", async () => {
    const teams = seeded.filter((s) => s.proIds.length >= 2);
    const orgs = await db.organization.findMany({ where: { id: { in: teams.map((t) => t.id) } } });
    const byId = new Map(orgs.map((o) => [o.id, o]));
    const from = addDays(todayInTz(TZ), 1);
    const seq = await pool(300, 1, (i) => {
      const t = teams[i % teams.length];
      return getTeamAvailability({ organization: byId.get(t.id)!, professionalIds: t.proIds, durationMinutes: 30, fromDateStr: from, days: 7 });
    });
    const conc = await pool(600, 20, (i) => {
      const t = teams[i % teams.length];
      return getTeamAvailability({ organization: byId.get(t.id)!, professionalIds: t.proIds, durationMinutes: 30, fromDateStr: from, days: 7 });
    });
    const team = await pool(300, 10, (i) => listPublicTeam(db, byId.get(teams[i % teams.length].id)!));
    results.availability = { sequential: stats(seq.durations), concurrent20: { ...stats(conc.durations), perSecond: +(600 / conc.seconds).toFixed(0) }, publicTeam: stats(team.durations) };
    expect(stats(seq.durations).p95).toBeLessThan(2000);
  });

  it("reservas simultáneas: sin superposiciones ni cupos de más", async () => {
    // 1) Un mismo horario, un negocio de 5 profesionales, 40 clientes a la vez: entran exactamente 5.
    const big = seeded.find((s) => s.proIds.length === 5)!;
    const org = await db.organization.findUniqueOrThrow({ where: { id: big.id } });
    const startsAt = zonedTimeToUtc(addDays(todayInTz(TZ), 20), 600, TZ); // día sin turnos sembrados
    const same = await pool(40, 40, (i) =>
      createAppointment({ organization: org, serviceId: big.serviceId, startsAt, customer: { name: `Simultáneo ${i}`, email: `sim${i}@example.com`, phone: null }, actor: "customer", professional: "any", idempotencyKey: `load-${i}` }),
    );
    const ok = same.values.filter((r) => r.ok).length;
    // 2) Reservas repartidas entre muchos negocios a la vez.
    const spread = await pool(300, 30, async (i) => {
      const s = seeded[i % seeded.length];
      const o = await db.organization.findUniqueOrThrow({ where: { id: s.id } });
      return createAppointment({ organization: o, serviceId: s.serviceId, startsAt: zonedTimeToUtc(addDays(todayInTz(TZ), 25 + (i % 10)), 540 + (i % 12) * 30, TZ), customer: { name: `Repartido ${i}`, email: `rep${i}@example.com`, phone: null }, actor: "customer", professional: "any" });
    });
    const overlaps = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM "appointments" x JOIN "appointments" y
        ON x."professionalId" = y."professionalId" AND x."id" < y."id" AND x."status" <> 'canceled' AND y."status" <> 'canceled'
       AND x."startsAt" < y."endsAt" AND y."startsAt" < x."endsAt"`;
    results.concurrentBookings = {
      sameSlot: { attempts: 40, accepted: ok, expected: 5, ...stats(same.durations) },
      spreadAcrossBusinesses: { attempts: 300, accepted: spread.values.filter((r) => r.ok).length, ...stats(spread.durations), perSecond: +(300 / spread.seconds).toFixed(0) },
      overlappingAppointments: Number(overlaps[0].n),
    };
    expect(ok).toBe(5);
    expect(Number(overlaps[0].n)).toBe(0);
  });

  it("agenda del administrador y consultas del profesional", async () => {
    const day = addDays(todayInTz(TZ), 1);
    const from = zonedTimeToUtc(day, 0, TZ);
    const to = zonedTimeToUtc(addDays(day, 1), 0, TZ);
    const admin = await pool(400, 10, (i) => {
      const s = seeded[i % seeded.length];
      return db.appointment.findMany({
        where: { ...appointmentScope({ organization: { id: s.id } as never, restrictedProfessionalId: null }), startsAt: { gte: from, lt: to } },
        include: { customer: { select: { name: true } }, service: { select: { name: true } }, professional: { select: { displayName: true, color: true } } },
        orderBy: { startsAt: "asc" },
      });
    });
    const pro = await pool(400, 10, async (i) => {
      const s = seeded[i % seeded.length];
      const ctx = { organization: { id: s.id } as never, restrictedProfessionalId: s.proIds[0] };
      const [appointments, customers] = await Promise.all([
        db.appointment.findMany({ where: { ...appointmentScope(ctx), startsAt: { gte: from } }, take: 50, orderBy: { startsAt: "asc" } }),
        db.customer.findMany({ where: customerScope(ctx), take: 50, orderBy: { name: "asc" } }),
      ]);
      return [appointments.length, customers.length];
    });
    results.agenda = { adminDay: stats(admin.durations), professionalViews: stats(pro.durations) };
    expect(stats(admin.durations).p95).toBeLessThan(2000);
  });

  it("inicio de sesión y cambio de negocio", async () => {
    // Una persona con 3 membresías, como una profesional que atiende en varios lugares.
    const user = await db.user.findUniqueOrThrow({ where: { id: seeded[0].ownerId } });
    for (const s of seeded.slice(1, 3)) await db.membership.create({ data: { organizationId: s.id, userId: user.id, role: "professional" } });
    const login = await pool(40, 4, async () => {
      const row = await db.user.findUnique({ where: { email: user.email } });
      return verifyPassword("Contrasena123", row!.passwordHash);
    });
    const switching = await pool(300, 10, () => listWorkspaces(user.id, seeded[0].id));
    results.login = { bcryptVerifyAndLookup4Concurrent: stats(login.durations), cpus: os.cpus().length };
    results.organizationSwitching = stats(switching.durations);
    expect(login.values.every(Boolean)).toBe(true);
  });

  it("worker de notificaciones", async () => {
    const orgs = seeded.slice(0, 20);
    const appointments = await db.appointment.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) } }, take: 3000, select: { id: true, organizationId: true } });
    await db.notification.createMany({
      data: appointments.map((a, i) => ({ organizationId: a.organizationId, appointmentId: a.id, type: "reminder" as const, recipient: `c${i % 60}@example.com`, scheduledFor: new Date(Date.now() - 1000), idempotencyKey: `load-notif-${i}-${randomBytes(4).toString("hex")}` })),
    });
    vi.stubEnv("RESEND_API_KEY", "re_loadtest");
    vi.stubEnv("EMAIL_FROM", "Prueba <prueba@example.com>");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    const started = performance.now();
    let sent = 0;
    let claimed = 0;
    for (let round = 0; round < 200; round++) {
      const summary = await processDueNotifications(25);
      sent += summary.sent;
      claimed += summary.claimed;
      if (summary.claimed === 0) break;
    }
    const seconds = (performance.now() - started) / 1000;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    results.worker = { queued: appointments.length, claimed, sent, seconds: +seconds.toFixed(1), perSecond: +(claimed / Math.max(seconds, 0.001)).toFixed(0), note: "envío simulado: mide la cola y las consultas, no a Resend" };
    expect(claimed).toBeGreaterThan(0);
  });

  it("memoria y resumen", async () => {
    clearInterval(sampler);
    const mem = process.memoryUsage();
    results.memory = { rssMB: Math.round(mem.rss / 1048576), peakRssMB: Math.round(Math.max(peakRss, mem.rss) / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) };
    results.environment = {
      date: new Date().toISOString(),
      node: process.version,
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemGB: +(os.totalmem() / 1073741824).toFixed(1),
      postgres: "PostgreSQL 17 en Docker, en la misma máquina, base descartable",
      note: "Local, sin red ni servidor web: no extrapolar al VPS de producción.",
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/loadtest-local.json", JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    expect(results.memory).toBeDefined();
  });
});
