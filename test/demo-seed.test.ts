import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listPublicTeam } from "@/modules/team/eligibility";
import { getProfessionalQuota } from "@/modules/team/professionals";

/**
 * Los tres negocios de demostración son reproducibles: el script los crea desde cero en la base local,
 * respetando los cupos de cada plan, y los borra por completo. Nada de esto toca producción: el script se
 * niega a correr contra una base que no sea local (se verifica abajo).
 */

const run = (args: string[] = [], env: Record<string, string> = {}) =>
  execFileSync("node", ["scripts/seed-demos.mjs", ...args], { env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

afterAll(() => run(["--clean"]));

describe("negocios de demostración", () => {
  it("se crean desde cero: independiente, barbería con 3 y centro estético con 5, dentro de los cupos de su plan", async () => {
    const output = run();
    expect(output).toMatch(/Contraseña de todas las cuentas demo/);

    const orgs = await db.organization.findMany({ where: { slug: { startsWith: "demo-" } }, orderBy: { slug: "asc" } });
    expect(orgs.map((o) => o.slug)).toEqual(["demo-barberia-don-lucho", "demo-centro-almendra", "demo-espacio-raiz"]);

    const [barberia, centro, raiz] = orgs;
    expect(raiz).toMatchObject({ status: "trial", teamModeEnabled: false, workMode: "solo" });
    expect(await getProfessionalQuota(db, raiz)).toMatchObject({ active: 1, limit: 2 });

    expect(await getProfessionalQuota(db, barberia)).toMatchObject({ active: 3, limit: 5, tier: "equipo", overLimit: false });
    expect(await getProfessionalQuota(db, centro)).toMatchObject({ active: 5, limit: 5, tier: "equipo", overLimit: false });

    // Barbería: «cualquier profesional» + un servicio que solo hace uno; turnos simultáneos sin pisarse.
    const team = await listPublicTeam(db, barberia);
    expect(team.professionals.map((p) => p.displayName)).toEqual(["Luciano", "Mateo", "Santi"]);
    expect(team.professionals.every((p) => p.photoImageId)).toBe(true);
    const shave = await db.service.findFirstOrThrow({ where: { organizationId: barberia.id, name: { startsWith: "Afeitado" } } });
    expect(team.byService[shave.id]).toHaveLength(1);
    const simultaneous = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM (SELECT "startsAt" FROM "appointments" WHERE "organizationId" = ${barberia.id} GROUP BY "startsAt" HAVING count(DISTINCT "professionalId") >= 2) t`;
    expect(Number(simultaneous[0].n)).toBeGreaterThanOrEqual(1);

    // Centro: cuentas individuales y permisos; agendas con horarios distintos.
    expect(centro).toMatchObject({ teamAccountsEnabled: true });
    expect(await db.membership.count({ where: { organizationId: centro.id, role: "professional" } })).toBe(3);
    expect(await db.professional.count({ where: { organizationId: centro.id, userId: { not: null } } })).toBe(3);
    const hours = await db.availabilityRule.groupBy({ by: ["professionalId"], where: { organizationId: centro.id }, _count: { _all: true } });
    expect(hours).toHaveLength(5);

    // Todo es ficticio.
    const emails = await db.user.findMany({ where: { memberships: { some: { organizationId: { in: orgs.map((o) => o.id) } } } }, select: { email: true } });
    expect(emails.every((u) => u.email.endsWith("@demo.agendia.example.com"))).toBe(true);
    const customerEmails = await db.customer.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) } }, select: { email: true } });
    expect(customerEmails.every((c) => c.email?.endsWith("@example.com"))).toBe(true);
  });

  it("es repetible: volver a correrlo recrea todo sin duplicar", async () => {
    run();
    run();
    expect(await db.organization.count({ where: { slug: { startsWith: "demo-" } } })).toBe(3);
    expect(await db.user.count({ where: { email: { endsWith: "@demo.agendia.example.com" } } })).toBe(6);
  });

  it("se niega a correr contra una base que no es local o en producción", () => {
    for (const env of [{ DATABASE_URL: "postgresql://u:p@db.ejemplo.com:5432/x" }, { NODE_ENV: "production" }] as Array<Record<string, string>>) {
      let failed = false;
      try {
        run([], env);
      } catch (error) {
        failed = true;
        expect(String((error as { stderr?: string }).stderr)).toMatch(/Rechazado/);
      }
      expect(failed).toBe(true);
    }
  });

  it("--clean los borra sin dejar rastros", async () => {
    run(["--clean"]);
    expect(await db.organization.count({ where: { slug: { startsWith: "demo-" } } })).toBe(0);
    expect(await db.user.count({ where: { email: { endsWith: "@demo.agendia.example.com" } } })).toBe(0);
  });
});
