import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { createProfessional, getProfessionalQuota } from "@/modules/team/professionals";
import { createSchedulableOrganization, refreshOrganization } from "./helpers";

/**
 * Los interruptores globales (PUBLISH_TEAM_PLANS, TEAM_MODE_ENABLED, TEAM_ACCOUNTS_ENABLED) deciden QUÉ funciones
 * existen, nunca CUÁNTOS profesionales admite un negocio: el cupo sale solo del plan y de un pago verificado.
 */
type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const created: Tenant[] = [];

async function shop(options: { status?: Organization["status"]; plan?: "mensual" | "equipo"; paid?: boolean; teamMode?: boolean } = {}) {
  const tenant = await createSchedulableOrganization();
  created.push(tenant);
  await db.organization.update({
    where: { id: tenant.organization.id },
    data: { status: options.status ?? "trial", teamModeEnabled: options.teamMode ?? false },
  });
  if (options.plan) {
    const plan = await db.plan.upsert({
      where: { code: options.plan },
      update: {},
      create: { code: options.plan, name: options.plan === "equipo" ? "Plan Equipo" : "Plan Profesional", price: options.plan === "equipo" ? 19900 : 9900 },
    });
    await db.subscription.create({
      data: { organizationId: tenant.organization.id, planId: plan.id, status: "active", lastPaymentAt: options.paid === false ? null : new Date() },
    });
  }
  return () => refreshOrganization(tenant.organization.id);
}

async function addUntilRejected(org: () => Promise<Organization>, max = 8): Promise<number> {
  let added = 0;
  for (let i = 0; i < max; i++) {
    const result = await createProfessional(await org(), { displayName: `Profesional ${i + 2}` });
    if (!result.ok) return added;
    added++;
  }
  return added;
}

function allGlobalSwitchesOn() {
  vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
  vi.stubEnv("TEAM_MODE_ENABLED", "1");
  vi.stubEnv("TEAM_ACCOUNTS_ENABLED", "1");
}

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  for (const tenant of created) await db.subscription.deleteMany({ where: { organizationId: tenant.organization.id } });
  for (const tenant of created) await tenant.cleanup();
});

describe("interruptores globales y cupos", () => {
  it("con todo encendido, la prueba gratuita sigue admitiendo 2 profesionales (el dueño + 1)", async () => {
    allGlobalSwitchesOn();
    const org = await shop({ status: "trial" });
    expect(await addUntilRejected(org)).toBe(1);
    expect((await getProfessionalQuota(db, await org())).limit).toBe(2);
  });

  it("con todo encendido, el Plan Profesional pago sigue admitiendo 2", async () => {
    allGlobalSwitchesOn();
    const org = await shop({ status: "active", plan: "mensual" });
    expect(await addUntilRejected(org)).toBe(1);
  });

  it("con todo encendido, el Plan Equipo SIN cobro verificado admite solo 2", async () => {
    allGlobalSwitchesOn();
    const org = await shop({ status: "active", plan: "equipo", paid: false });
    expect(await addUntilRejected(org)).toBe(1);
    expect((await getProfessionalQuota(db, await org())).tier).toBe("profesional");
  });

  it("con todo encendido, el Plan Equipo con cobro verificado admite 5 y no más", async () => {
    allGlobalSwitchesOn();
    const org = await shop({ status: "active", plan: "equipo", paid: true });
    expect(await addUntilRejected(org)).toBe(4);
    expect((await getProfessionalQuota(db, await org())).limit).toBe(5);
  });

  it("una cuenta cancelada, suspendida o con la prueba vencida vuelve al cupo de la prueba aunque tenga el Plan Equipo", async () => {
    allGlobalSwitchesOn();
    for (const status of ["canceled", "suspended"] as const) {
      const org = await shop({ status, plan: "equipo", paid: true });
      const quota = await getProfessionalQuota(db, await org());
      expect(quota).toMatchObject({ limit: 2, source: "trial" });
    }
  });

  it("TEAM_FEATURES_PAUSED=1 frena la activación automática de PUBLISH_TEAM_PLANS", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    vi.stubEnv("TEAM_FEATURES_PAUSED", "1");
    const org = await shop({ status: "trial", teamMode: false });
    const result = await createProfessional(await org(), { displayName: "Segundo" });
    expect(result).toMatchObject({ ok: false, code: "team_disabled" });
  });

  it("PUBLISH_TEAM_PLANS=1 habilita el modo equipo sin tocar el cupo", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    const org = await shop({ status: "trial", teamMode: false });
    expect(await addUntilRejected(org)).toBe(1);
  });
});
