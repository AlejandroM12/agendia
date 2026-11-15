import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { ensurePlan } from "@/modules/billing/catalog";
import { createSchedulableOrganization, fakeContext } from "./helpers";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { alignPlanPricesAction, reconcileOrganizationAction, setOrganizationFeatureAction } from "@/modules/admin/actions";
import { getOrganizationAdminView } from "@/modules/admin/overview";
import { addProfessional } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let target: Tenant;
let operator: Tenant;

const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
async function actAs(isPlatformAdmin: boolean) {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: operator.organization.id } });
  session.current = fakeContext({ userId: operator.userId, email: operator.ownerEmail, organization, isPlatformAdmin });
}

beforeEach(async () => {
  target = await createSchedulableOrganization();
  operator = await createSchedulableOrganization();
});
afterEach(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: [target.organization.id, operator.organization.id] } } });
  await target.cleanup();
  await operator.cleanup();
});

describe("panel de plataforma: vista de un negocio", () => {
  it("resume plan, cupos, equipo y consumo, sin datos de clientes ni credenciales", async () => {
    await db.organization.update({ where: { id: target.organization.id }, data: { teamModeEnabled: true } });
    await addProfessional(target.organization.id, { displayName: "Otra" });
    const customer = await db.customer.create({ data: { organizationId: target.organization.id, name: "Cliente Secreto", email: "secreto@example.com", phone: "1155550000" } });
    await db.notification.create({
      data: {
        organizationId: target.organization.id,
        type: "booking_confirmation",
        recipient: customer.email!,
        scheduledFor: new Date(),
        status: "failed",
        idempotencyKey: `k-${Date.now()}`,
        lastError: "Resend rechazó el envío a secreto@example.com",
      },
    });

    const view = (await getOrganizationAdminView(target.organization.id))!;
    expect(view).toMatchObject({ name: target.organization.name, status: "trial", plan: null, seats: { active: 2, limit: 2, available: 0 } });
    expect(view.features).toMatchObject({ teamMode: true, teamModeFlag: true, accounts: false });
    expect(view.billingNeeded.join(" ")).toMatch(/prueba/);
    expect(view.emails.byType.booking_confirmation).toMatchObject({ failed: 1 });

    const dump = JSON.stringify(view);
    expect(dump).not.toMatch(/secreto@example\.com|Cliente Secreto|1155550000/);
    expect(dump).not.toMatch(/passwordHash|token|secret/i);
  });

  it("detecta una suscripción con cambio de plan sin confirmar y un importe distinto del de lista", async () => {
    const pro = await ensurePlan("profesional");
    const team = await ensurePlan("equipo");
    await db.subscription.create({
      data: {
        organizationId: target.organization.id,
        planId: pro.id,
        status: "active",
        contractedAmount: 14000,
        pendingPlanId: team.id,
        pendingKind: "upgrade",
        pendingProviderSubscriptionId: `pre-${Date.now()}`,
      },
    });
    const view = (await getOrganizationAdminView(target.organization.id))!;
    expect(view.billingNeeded.join(" | ")).toMatch(/Plan Equipo sin confirmar/);
    expect(view.billingNeeded.join(" | ")).toMatch(/importe distinto/);
    await db.subscription.deleteMany({ where: { organizationId: target.organization.id } });
  });
});

describe("panel de plataforma: acciones sensibles", () => {
  it("solo una cuenta de plataforma puede habilitar funciones, conciliar o alinear precios", async () => {
    await actAs(false);
    expect(await run(() => setOrganizationFeatureAction(target.organization.id, "team", true))).toBe("NOT_FOUND");
    expect(await run(() => reconcileOrganizationAction(target.organization.id))).toBe("NOT_FOUND");
    expect(await run(() => alignPlanPricesAction())).toBe("NOT_FOUND");
    expect((await db.organization.findUniqueOrThrow({ where: { id: target.organization.id } })).teamModeEnabled).toBe(false);
  });

  it("habilitar y apagar una función por negocio queda auditado y no borra datos", async () => {
    await actAs(true);
    await setOrganizationFeatureAction(target.organization.id, "accounts", true);
    expect(await db.organization.findUniqueOrThrow({ where: { id: target.organization.id } })).toMatchObject({ teamModeEnabled: true, teamAccountsEnabled: true });
    await addProfessional(target.organization.id, { displayName: "Otra" });
    await setOrganizationFeatureAction(target.organization.id, "team", false);
    expect(await db.organization.findUniqueOrThrow({ where: { id: target.organization.id } })).toMatchObject({ teamModeEnabled: false, teamAccountsEnabled: false });
    expect(await db.professional.count({ where: { organizationId: target.organization.id } })).toBe(2);
    const entries = await db.auditLog.findMany({ where: { organizationId: target.organization.id, action: { startsWith: "admin.feature" } }, orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => e.action)).toEqual(["admin.feature.accounts.enabled", "admin.feature.team.disabled"]);
    expect(entries.every((e) => e.userId === operator.userId)).toBe(true);
  });

  it("la conciliación sin Mercado Pago configurado no rompe y deja registro", async () => {
    await actAs(true);
    const result = await reconcileOrganizationAction(target.organization.id);
    expect(result).toMatchObject({ ok: true });
    expect(await db.auditLog.count({ where: { organizationId: target.organization.id, action: "admin.reconcile" } })).toBe(1);
  });

  it("alinear precios corrige una diferencia y no toca las suscripciones vigentes", async () => {
    await actAs(true);
    await db.plan.update({ where: { code: "equipo" }, data: { price: 18000 } });
    try {
      expect(await alignPlanPricesAction()).toMatchObject({ ok: true, message: expect.stringContaining("equipo 18000 → 19900") });
      expect((await db.plan.findUniqueOrThrow({ where: { code: "equipo" } })).price).toBe(19900);
    } finally {
      await db.plan.update({ where: { code: "equipo" }, data: { price: 19900 } });
      await db.auditLog.deleteMany({ where: { action: "admin.plan.price_aligned", userId: operator.userId } });
    }
  });
});
