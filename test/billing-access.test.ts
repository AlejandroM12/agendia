import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { canManageBilling, canPerformWriteActions } from "@/lib/organization-access";
import { createSchedulableOrganization, fakeContext, refreshOrganization } from "./helpers";

/**
 * Contratar un plan no depende del modo de solo lectura: una prueba vencida, una cuenta bloqueada o una suscripción
 * cancelada restringen las operaciones del negocio, nunca la salida de esa situación. Solo una cuenta suspendida
 * (decisión de la plataforma) no puede contratar. Mercado Pago está SIMULADO: no se crea ningún cobro real.
 */

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

import { cancelSubscriptionAction, startSubscriptionAction } from "@/modules/billing/actions";
import { createAppointmentAction } from "@/modules/appointments/actions";
import { ensurePlan } from "@/modules/billing/catalog";
import { getPreapproval } from "@/modules/billing/mercadopago";
import { applyAuthorizedPayment, applyPreapprovalState } from "@/modules/billing/subscriptions";
import { getProfessionalQuota } from "@/modules/team/professionals";

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let ctx: Ctx;
let calls: Array<{ method: string; path: string }>;
let remote: Map<string, { id: string; status: string; external_reference: string; amount: number }>;
let counter = 0;

function installMercadoPago() {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR-simulado");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
  vi.stubEnv("MERCADOPAGO_MODE", "live");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
      if (path === "/users/me") return json({ tags: [] }); // credenciales de producción
      if (method === "POST" && path === "/preapproval") {
        const body = JSON.parse(String(init?.body)) as { external_reference: string; auto_recurring: { transaction_amount: number } };
        const id = `pre-${++counter}-${Date.now()}`;
        remote.set(id, { id, status: "pending", external_reference: body.external_reference, amount: body.auto_recurring.transaction_amount });
        return json({ id, init_point: `https://mp.test/checkout/${id}`, status: "pending" });
      }
      const match = path.match(/^\/preapproval\/(.+)$/);
      if (match) {
        const item = remote.get(decodeURIComponent(match[1]));
        if (!item) return new Response("{}", { status: 404 });
        if (method === "PUT") return json({ ...item, status: "cancelled", auto_recurring: { transaction_amount: item.amount, currency_id: "ARS" } });
        return json({
          id: item.id,
          status: item.status,
          external_reference: item.external_reference,
          next_payment_date: new Date(Date.now() + 30 * 86400000).toISOString(),
          auto_recurring: { transaction_amount: item.amount, currency_id: "ARS" },
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
const preapprovalCreations = () => calls.filter((call) => call.method === "POST" && call.path === "/preapproval").length;
const subscriptionCount = () => db.subscription.count({ where: { organizationId: ctx.organization.id } });

async function actAs(role: AppContext["role"] = "owner") {
  const organization = await refreshOrganization(ctx.organization.id);
  session.current = fakeContext({ userId: ctx.userId, email: ctx.ownerEmail, organization, role });
}

const DAY = 86400000;
/** Los estados en los que hoy no se pueden crear ni modificar turnos. */
const READ_ONLY_STATES: Record<string, () => Promise<void>> = {
  "prueba vencida (solo lectura)": async () => {
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 2 * DAY) } });
  },
  "bloqueada (terminó la gracia)": async () => {
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 60 * DAY), readonlyUntil: new Date(Date.now() - 30 * DAY) } });
  },
  "suscripción cancelada": async () => {
    const plan = await ensurePlan("profesional");
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "canceled" } });
    await db.subscription.create({ data: { organizationId: ctx.organization.id, planId: plan.id, status: "canceled", providerSubscriptionId: "pre-vieja", contractedAmount: plan.price, contractedCurrency: "ARS", canceledAt: new Date() } });
  },
};

beforeEach(async () => {
  ctx = await createSchedulableOrganization();
  calls = [];
  remote = new Map();
  installMercadoPago();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { organizationId: ctx.organization.id } });
  await db.subscription.deleteMany({ where: { organizationId: ctx.organization.id } });
  await ctx.cleanup();
});

describe("regla central: quién puede contratar", () => {
  it("solo una cuenta suspendida no puede; todas las demás sí, incluidas las de solo lectura", () => {
    for (const status of ["trial", "trial_readonly", "active", "past_due", "canceled", "locked"] as const) {
      expect(canManageBilling({ status }), status).toBe(true);
    }
    expect(canManageBilling({ status: "suspended" })).toBe(false);
  });

  it("el solo lectura sigue limitando las operaciones del negocio (no se confunde con la contratación)", () => {
    const base = { trialEndsAt: new Date(Date.now() - 2 * DAY), readonlyUntil: null };
    expect(canPerformWriteActions({ ...base, status: "trial_readonly" })).toBe(false);
    expect(canPerformWriteActions({ ...base, status: "canceled" })).toBe(false);
    expect(canPerformWriteActions({ ...base, status: "suspended" })).toBe(false);
    expect(canManageBilling({ status: "trial_readonly" })).toBe(true);
  });
});

describe("contratar con la prueba vigente o vencida", () => {
  it("con la prueba vigente el propietario llega a Mercado Pago y no se activa nada todavía", async () => {
    await actAs("owner");
    expect(await run(() => startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" })))).toMatch(/^REDIRECT:https:\/\/mp\.test\/checkout\//);
    expect((await refreshOrganization(ctx.organization.id)).status).toBe("trial");
    expect(await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } })).toMatchObject({ status: "pending", contractedAmount: 9900 });
  });

  for (const [name, prepare] of Object.entries(READ_ONLY_STATES)) {
    it(`${name}: el propietario puede contratar Profesional y Equipo, y las operaciones del negocio siguen bloqueadas`, async () => {
      vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
      await prepare();
      await actAs("owner");
      const context = session.current as AppContext;
      expect(context.canWrite, "precondición: la cuenta está en solo lectura").toBe(false);
      const before = (await refreshOrganization(ctx.organization.id)).status;

      expect(await run(() => startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" })))).toMatch(/^REDIRECT:https:\/\/mp\.test\/checkout\//);
      expect(await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } })).toMatchObject({ status: "pending", contractedAmount: 9900 });
      expect(await run(() => startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" })))).toMatch(/^REDIRECT:https:\/\/mp\.test\/checkout\//);
      expect(await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } })).toMatchObject({ status: "pending", contractedAmount: 19900 });

      // Contratar no reactiva nada por sí solo: el estado de la cuenta no cambió.
      expect((await refreshOrganization(ctx.organization.id)).status).toBe(before);
      // Y lo operativo sigue bloqueado.
      expect(await createAppointmentAction(undefined, form({}))).toMatchObject({ message: expect.stringContaining("solo lectura") });
    });
  }

  it("el Plan Equipo solo se vende si está publicado, también desde el solo lectura", async () => {
    await READ_ONLY_STATES["prueba vencida (solo lectura)"]();
    await actAs("owner");
    expect(await startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" }))).toMatchObject({ message: "Ese plan todavía no está disponible." });
    expect(preapprovalCreations()).toBe(0);
  });
});

describe("autorización en el servidor", () => {
  it("una cuenta suspendida no puede contratar ni invocando la acción directamente", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "suspended" } });
    await actAs("owner");
    for (const tier of ["profesional", "equipo"]) {
      expect(await startSubscriptionAction(undefined, form({ tier, payerEmail: "p@example.com" }))).toMatchObject({ message: expect.stringContaining("suspendida") });
    }
    expect(preapprovalCreations()).toBe(0);
    expect(await subscriptionCount()).toBe(0);
  });

  it("sin billing.manage (administrador o profesional) no se contrata, ni con la prueba vigente ni vencida", async () => {
    for (const prepare of [async () => undefined, READ_ONLY_STATES["prueba vencida (solo lectura)"]]) {
      await prepare();
      for (const role of ["admin", "professional"] as const) {
        await actAs(role);
        expect(await startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" }))).toMatchObject({ message: expect.any(String) });
        expect(await cancelSubscriptionAction()).toMatchObject({ message: expect.any(String) });
      }
    }
    expect(preapprovalCreations()).toBe(0);
    expect(await subscriptionCount()).toBe(0);
  });

  it("con Mercado Pago sin configurar no se contrata y se ofrece el contacto, también en solo lectura", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "");
    await READ_ONLY_STATES["prueba vencida (solo lectura)"]();
    await actAs("owner");
    expect(await startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" }))).toMatchObject({ message: expect.stringContaining("Escribinos") });
    expect(preapprovalCreations()).toBe(0);
  });

  it("en modo de prueba de Mercado Pago solo pagan las cuentas autorizadas, también en solo lectura (sin cambios)", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "test");
    await READ_ONLY_STATES["prueba vencida (solo lectura)"]();
    await actAs("owner");
    expect(await startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" }))).toMatchObject({ message: expect.stringContaining("todavía no está habilitado") });
  });
});

describe("sin suscripciones duplicadas y sin activar antes del pago", () => {
  it("contratar dos veces desde el solo lectura deja una sola suscripción; la anterior sin autorizar se da de baja al autorizar la nueva", async () => {
    await READ_ONLY_STATES["prueba vencida (solo lectura)"]();
    await actAs("owner");
    await run(() => startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" })));
    const first = (await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } })).providerSubscriptionId!;
    await run(() => startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" })));
    const second = await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } });
    expect(await subscriptionCount()).toBe(1);
    expect(second.providerSubscriptionId).not.toBe(first);
    expect(second.retiredProviderSubscriptionId).toBe(first);
  });

  it("quien ya tiene el plan vigente no vuelve a contratarlo", async () => {
    const plan = await ensurePlan("profesional");
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "active" } });
    await db.subscription.create({ data: { organizationId: ctx.organization.id, planId: plan.id, status: "active", providerSubscriptionId: "pre-vigente", contractedAmount: plan.price, contractedCurrency: "ARS", lastPaymentAt: new Date(), currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
    await actAs("owner");
    expect(await startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" }))).toMatchObject({ message: expect.stringContaining("Ya estás") });
    expect(preapprovalCreations()).toBe(0);
  });

  it("desde el solo lectura la cuenta se reactiva solo cuando Mercado Pago confirma la autorización, y los lugares del Equipo solo con el cobro aprobado", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    await READ_ONLY_STATES["prueba vencida (solo lectura)"]();
    await actAs("owner");
    await run(() => startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" })));
    const id = (await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } })).providerSubscriptionId!;

    // Volver de la pantalla de pago sin que Mercado Pago confirme no cambia nada.
    expect(await applyPreapprovalState(await getPreapproval(id))).toBe("applied");
    expect((await refreshOrganization(ctx.organization.id)).status).toBe("trial_readonly");
    await actAs("owner");
    expect((session.current as AppContext).canWrite).toBe(false);

    // Mercado Pago autoriza: la cuenta vuelve a operar, con los lugares de la prueba hasta el primer cobro.
    remote.get(id)!.status = "authorized";
    await applyPreapprovalState(await getPreapproval(id));
    expect((await refreshOrganization(ctx.organization.id)).status).toBe("active");
    expect((await getProfessionalQuota(db, await refreshOrganization(ctx.organization.id))).limit).toBe(2);

    // Un cobro aprobado por el importe del plan habilita los 5 lugares del Equipo.
    await applyAuthorizedPayment({ id: "pay-1", preapproval_id: id, transaction_amount: 19900, currency_id: "ARS", payment: { id: 1, status: "approved" } } as never);
    expect(await getProfessionalQuota(db, await refreshOrganization(ctx.organization.id))).toMatchObject({ limit: 5, tier: "equipo" });
    await actAs("owner");
    expect((session.current as AppContext).canWrite).toBe(true);
  });

  it("un cobro aprobado con otro importe no habilita el Equipo (verificación contra lo contratado)", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    await READ_ONLY_STATES["prueba vencida (solo lectura)"]();
    await actAs("owner");
    await run(() => startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" })));
    const id = (await db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } })).providerSubscriptionId!;
    remote.get(id)!.status = "authorized";
    await applyPreapprovalState(await getPreapproval(id));
    await applyAuthorizedPayment({ id: "pay-2", preapproval_id: id, transaction_amount: 100, currency_id: "ARS", payment: { id: 2, status: "approved" } } as never);
    expect((await getProfessionalQuota(db, await refreshOrganization(ctx.organization.id))).limit).toBe(2);
  });
});
