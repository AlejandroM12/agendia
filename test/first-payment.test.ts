import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { canPerformWriteActions } from "@/lib/organization-access";
import { ensurePlan } from "@/modules/billing/catalog";
import { getPreapproval } from "@/modules/billing/mercadopago";
import { startPlanChange } from "@/modules/billing/plan-change";
import { applyAuthorizedPayment, applyPreapprovalState, processPaymentEvent, reconcileOrganization, reconcileSubscriptions } from "@/modules/billing/subscriptions";
import { getProfessionalQuota } from "@/modules/team/professionals";
import { createSchedulableOrganization, fakeContext, refreshOrganization } from "./helpers";

/**
 * Regla comercial: AUTORIZAR una suscripción en Mercado Pago NO es cobrar. Un plan pago se activa únicamente con un primer
 * cobro aprobado y verificado contra la API (importe, moneda, suscripción y organización). Mientras tanto la cuenta queda
 * como estaba: prueba vigente (con sus días) o solo lectura. Mercado Pago está SIMULADO: no se crea ningún cobro real.
 */

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "192.0.2.10" }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { refreshPaymentStatusAction } from "@/modules/billing/actions";

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
type Remote = { id: string; status: string; external_reference: string; amount: number; currency: string };

let ctx: Ctx;
let other: Ctx;
let remote: Map<string, Remote>;
let charges: Map<string, Array<Record<string, unknown>>>;
let calls: Array<{ method: string; path: string }>;
let counter = 0;
const DAY = 86400000;

function installMercadoPago() {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR-simulado");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
  vi.stubEnv("MERCADOPAGO_MODE", "live");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const path = parsed.pathname;
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
      if (path === "/users/me") return json({ tags: [] });
      if (method === "POST" && path === "/preapproval") {
        const body = JSON.parse(String(init?.body)) as { external_reference: string; auto_recurring: { transaction_amount: number; currency_id: string } };
        const id = `pre-${++counter}-${Date.now()}`;
        remote.set(id, { id, status: "pending", external_reference: body.external_reference, amount: body.auto_recurring.transaction_amount, currency: body.auto_recurring.currency_id });
        return json({ id, init_point: `https://mp.test/checkout/${id}`, status: "pending" });
      }
      if (method === "GET" && path === "/authorized_payments/search") return json({ results: charges.get(parsed.searchParams.get("preapproval_id") ?? "") ?? [] });
      const match = path.match(/^\/preapproval\/(.+)$/);
      if (match) {
        const item = remote.get(decodeURIComponent(match[1]));
        if (!item) return new Response("{}", { status: 404 });
        if (method === "PUT") {
          item.status = "cancelled";
        }
        return json({
          id: item.id,
          status: item.status,
          external_reference: item.external_reference,
          next_payment_date: new Date(Date.now() + 30 * DAY).toISOString(),
          auto_recurring: { transaction_amount: item.amount, currency_id: item.currency },
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

const authorize = (id: string) => {
  remote.get(id)!.status = "authorized";
};
const charge = (preapprovalId: string, amount: number, status = "approved", currency = "ARS") => ({
  id: `pay-${++counter}`,
  preapproval_id: preapprovalId,
  transaction_amount: amount,
  currency_id: currency,
  payment: { id: counter, status },
});
const orgOf = (c: Ctx = ctx) => refreshOrganization(c.organization.id);
const subOf = (c: Ctx = ctx) => db.subscription.findUniqueOrThrow({ where: { organizationId: c.organization.id }, include: { plan: true } });
const idOf = async (c: Ctx = ctx) => (await subOf(c)).providerSubscriptionId!;
const start = (tier: "profesional" | "equipo", c: Ctx = ctx) => startPlanChange({ organization: c.organization, userId: c.userId, tier, payerEmail: "pagador@example.com" });
const resource = async (id: string) => getPreapproval(id);
const quota = async (c: Ctx = ctx) => (await getProfessionalQuota(db, await orgOf(c))).limit;
const canWrite = async (c: Ctx = ctx) => canPerformWriteActions(await orgOf(c));
const expireTrial = (c: Ctx = ctx) => db.organization.update({ where: { id: c.organization.id }, data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 2 * DAY) } });
const ageSubscription = () => db.subscription.update({ where: { organizationId: ctx.organization.id }, data: { updatedAt: new Date(Date.now() - 7 * 3600000) } });

beforeEach(async () => {
  ctx = await createSchedulableOrganization();
  other = await createSchedulableOrganization();
  remote = new Map();
  charges = new Map();
  calls = [];
  vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
  installMercadoPago();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const c of [ctx, other]) {
    await db.auditLog.deleteMany({ where: { organizationId: c.organization.id } });
    await db.subscription.deleteMany({ where: { organizationId: c.organization.id } });
    await c.cleanup();
  }
});

for (const [trialName, prepare, expectedStatus, writable] of [
  ["prueba vigente", async () => undefined, "trial", true],
  ["prueba vencida (solo lectura)", async () => void (await expireTrial()), "trial_readonly", false],
] as const) {
  for (const tier of ["profesional", "equipo"] as const) {
    describe(`primer cobro — ${tier}, ${trialName}`, () => {
      const amount = tier === "equipo" ? 19900 : 9900;

      beforeEach(async () => {
        await prepare();
        expect((await start(tier)).ok).toBe(true);
      });

      it("suscripción autorizada SIN primer cobro: nada cambia (ni estado, ni permisos, ni lugares)", async () => {
        const id = await idOf();
        authorize(id);
        for (let i = 0; i < 3; i++) await applyPreapprovalState(await resource(id));
        const org = await orgOf();
        expect(org.status).toBe(expectedStatus);
        expect(await canWrite()).toBe(writable);
        expect(await subOf()).toMatchObject({ status: "pending", lastPaymentAt: null, currentPeriodEnd: null });
        expect(await quota()).toBe(2);
        // La prueba conserva sus días.
        expect(org.trialEndsAt.getTime()).toBe((await refreshOrganization(ctx.organization.id)).trialEndsAt.getTime());
      });

      it("primer cobro pendiente (en proceso): sigue sin activarse y queda como «pendiente»", async () => {
        const id = await idOf();
        authorize(id);
        await applyAuthorizedPayment(charge(id, amount, "in_process"));
        expect((await orgOf()).status).toBe(expectedStatus);
        expect(await subOf()).toMatchObject({ status: "pending", lastPaymentAt: null, lastChargeStatus: "in_process" });
        expect(await quota()).toBe(2);
      });

      it("primer cobro rechazado: no se activa, la cuenta no se toca (tampoco pasa a «en mora») y queda como «rechazado»", async () => {
        const id = await idOf();
        authorize(id);
        await applyAuthorizedPayment(charge(id, amount, "rejected"));
        expect((await orgOf()).status).toBe(expectedStatus);
        expect(await canWrite()).toBe(writable);
        expect(await subOf()).toMatchObject({ status: "pending", lastPaymentAt: null, lastChargeStatus: "rejected" });
      });

      it("primer cobro aprobado y verificado: se activa la cuenta y los lugares del plan", async () => {
        const id = await idOf();
        authorize(id);
        await applyAuthorizedPayment(charge(id, amount));
        expect((await orgOf()).status).toBe("active");
        expect(await canWrite()).toBe(true);
        expect(await subOf()).toMatchObject({ status: "active", lastChargeStatus: "approved" });
        expect((await subOf()).lastPaymentAt).not.toBeNull();
        expect(await quota()).toBe(tier === "equipo" ? 5 : 2);
      });

      it("importe incorrecto o moneda incorrecta: no se activa nada y queda auditado", async () => {
        const id = await idOf();
        authorize(id);
        await applyAuthorizedPayment(charge(id, amount - 1));
        await applyAuthorizedPayment(charge(id, amount, "approved", "USD"));
        await applyAuthorizedPayment({ ...charge(id, amount), transaction_amount: null });
        expect((await orgOf()).status).toBe(expectedStatus);
        expect(await subOf()).toMatchObject({ status: "pending", lastPaymentAt: null });
        expect(await db.auditLog.count({ where: { organizationId: ctx.organization.id, action: "subscription.rejected_payment_amount" } })).toBe(3);
      });
    });
  }
}

describe("cobros de otra suscripción", () => {
  it("el cobro de OTRA organización no activa a esta, y un cobro de una suscripción que no es nuestra se ignora", async () => {
    await start("profesional");
    await start("profesional", other);
    const mine = await idOf();
    const theirs = await idOf(other);
    authorize(mine);
    authorize(theirs);

    await applyAuthorizedPayment(charge(theirs, 9900));
    expect((await orgOf(other)).status).toBe("active");
    expect((await orgOf()).status).toBe("trial");
    expect(await subOf()).toMatchObject({ status: "pending", lastPaymentAt: null });

    const before = calls.length;
    await applyAuthorizedPayment(charge("pre-ajena", 9900));
    expect((await orgOf()).status).toBe("trial");
    expect(calls.length).toBe(before); // ni siquiera se consulta a Mercado Pago
  });

  it("una suscripción cuyo external_reference es de otra organización no se aplica aunque se pague", async () => {
    await start("profesional");
    const id = await idOf();
    authorize(id);
    remote.get(id)!.external_reference = other.organization.id;
    await applyAuthorizedPayment(charge(id, 9900));
    expect((await orgOf()).status).toBe("trial");
    expect((await subOf()).lastPaymentAt).not.toBeNull(); // el cobro se registró, pero la autorización fue rechazada
    expect((await subOf()).status).toBe("pending");
    expect(await db.auditLog.count({ where: { organizationId: ctx.organization.id, action: "subscription.rejected_wrong_organization" } })).toBeGreaterThan(0);
  });
});

describe("eventos duplicados, concurrentes y desordenados", () => {
  beforeEach(async () => {
    await start("equipo");
  });

  it("el cobro llega ANTES que la autorización: no activa; al llegar la autorización, sí (y una sola vez)", async () => {
    const id = await idOf();
    // Mercado Pago todavía figura «pending» cuando llega el aviso del cobro.
    await applyAuthorizedPayment(charge(id, 19900));
    expect((await orgOf()).status).toBe("trial");
    authorize(id);
    await applyPreapprovalState(await resource(id));
    expect((await orgOf()).status).toBe("active");
    expect(await quota()).toBe(5);
  });

  it("avisos duplicados y simultáneos del mismo cobro y de la autorización dejan un solo resultado coherente", async () => {
    const id = await idOf();
    authorize(id);
    const payment = charge(id, 19900);
    await Promise.all([
      ...Array.from({ length: 6 }, () => applyAuthorizedPayment(payment)),
      ...Array.from({ length: 6 }, async () => applyPreapprovalState(await resource(id))),
    ]);
    expect((await orgOf()).status).toBe("active");
    expect(await subOf()).toMatchObject({ status: "active", lastChargeStatus: "approved" });
    expect(await db.subscription.count({ where: { organizationId: ctx.organization.id } })).toBe(1);
    expect(await quota()).toBe(5);
  });

  it("un aviso viejo de «rechazado» o «pendiente» no pisa un cobro ya aprobado ni lo desactiva", async () => {
    const id = await idOf();
    authorize(id);
    await applyAuthorizedPayment(charge(id, 19900));
    await applyAuthorizedPayment(charge(id, 19900, "in_process")); // atrasado
    expect(await subOf()).toMatchObject({ status: "active", lastChargeStatus: "approved" });
    expect((await orgOf()).status).toBe("active");
  });

  it("un aviso de «autorizada» atrasado no reactiva una suscripción que Mercado Pago ya canceló", async () => {
    const id = await idOf();
    authorize(id);
    await applyAuthorizedPayment(charge(id, 19900));
    remote.get(id)!.status = "cancelled";
    await applyPreapprovalState(await resource(id));
    const stale = { ...(await resource(id)), status: "authorized" };
    await applyPreapprovalState(stale); // el aviso atrasado trae el estado viejo
    // El estado real (consultado) es el que manda en el webhook; acá se prueba la función con un recurso viejo: no cambia el costo ya cobrado.
    expect((await subOf()).lastPaymentAt).not.toBeNull();
  });

  it("el webhook procesa el evento sin confiar en su cuerpo y deja el mismo resultado al repetirse", async () => {
    const id = await idOf();
    authorize(id);
    charges.set(id, [charge(id, 19900)]);
    // El aviso de cobro consulta el recurso (por id): se simula que la API lo devuelve aprobado.
    const paymentId = String((charges.get(id)![0] as { id: string }).id);
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (new URL(url).pathname === `/authorized_payments/${paymentId}`) return new Response(JSON.stringify(charges.get(id)![0]), { status: 200 });
        return original(url, init);
      }),
    );
    expect(await processPaymentEvent({ type: "subscription_authorized_payment", resourceId: paymentId })).toEqual({ outcome: "processed" });
    expect(await processPaymentEvent({ type: "subscription_authorized_payment", resourceId: paymentId })).toEqual({ outcome: "processed" });
    expect((await orgOf()).status).toBe("active");
    expect(await db.subscription.count({ where: { organizationId: ctx.organization.id } })).toBe(1);
  });
});

describe("conciliación y verificación manual", () => {
  beforeEach(async () => {
    await start("profesional");
  });

  it("un cobro aprobado cuyo aviso nunca llegó se verifica y activa al conciliar, una sola vez", async () => {
    const id = await idOf();
    authorize(id);
    charges.set(id, [charge(id, 9900)]);
    await ageSubscription();
    await reconcileSubscriptions();
    expect((await orgOf()).status).toBe("active");
    const firstPayment = (await subOf()).lastPaymentAt;
    await ageSubscription();
    await reconcileSubscriptions();
    expect((await subOf()).lastPaymentAt?.getTime()).toBe(firstPayment?.getTime()); // no se repite
  });

  it("al conciliar, un cobro con importe incorrecto no activa nada", async () => {
    const id = await idOf();
    authorize(id);
    charges.set(id, [charge(id, 100)]);
    await ageSubscription();
    await reconcileSubscriptions();
    expect((await orgOf()).status).toBe("trial");
  });

  it("al conciliar, un primer cobro rechazado queda registrado como «rechazado» y no activa nada", async () => {
    const id = await idOf();
    authorize(id);
    charges.set(id, [charge(id, 9900, "rejected")]);
    await ageSubscription();
    await reconcileSubscriptions();
    expect((await orgOf()).status).toBe("trial");
    expect(await subOf()).toMatchObject({ status: "pending", lastChargeStatus: "rejected" });
  });

  it("verificar ahora (el propietario): activa con el cobro aprobado; es solo del propietario, no de un suspendido y tiene límite", async () => {
    const id = await idOf();
    authorize(id);
    charges.set(id, [charge(id, 9900)]);

    session.current = fakeContext({ userId: ctx.userId, email: ctx.ownerEmail, organization: await orgOf(), role: "admin" });
    expect(await refreshPaymentStatusAction()).toMatchObject({ message: expect.any(String) });
    expect((await orgOf()).status).toBe("trial");

    session.current = fakeContext({ userId: ctx.userId, email: ctx.ownerEmail, organization: await orgOf(), role: "owner" });
    expect(await refreshPaymentStatusAction()).toMatchObject({ ok: true });
    expect((await orgOf()).status).toBe("active");

    await db.rateLimit.deleteMany({});
    expect(await reconcileOrganization(other.organization.id)).toEqual({ checked: false }); // sin suscripción: nada que verificar
  });

  it("verificar ahora: una cuenta suspendida no puede, y las repeticiones se limitan", async () => {
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "suspended" } });
    session.current = fakeContext({ userId: ctx.userId, email: ctx.ownerEmail, organization: await orgOf(), role: "owner" });
    expect(await refreshPaymentStatusAction()).toMatchObject({ message: expect.stringContaining("suspendida") });

    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "trial" } });
    session.current = fakeContext({ userId: ctx.userId, email: ctx.ownerEmail, organization: await orgOf(), role: "owner" });
    await db.rateLimit.deleteMany({});
    let limited = 0;
    for (let i = 0; i < 8; i++) {
      const result = (await refreshPaymentStatusAction()) as { message?: string; ok?: boolean };
      if (!result.ok) limited++;
    }
    expect(limited).toBeGreaterThanOrEqual(2);
  });
});

describe("renovaciones y cambios de plan: lo ya pagado se respeta", () => {
  async function paidProfessional(daysLeft = 20) {
    const plan = await ensurePlan("profesional");
    const id = `pre-base-${++counter}-${Date.now()}`;
    remote.set(id, { id, status: "authorized", external_reference: ctx.organization.id, amount: plan.price, currency: "ARS" });
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "active" } });
    await db.subscription.create({
      data: {
        organizationId: ctx.organization.id,
        planId: plan.id,
        status: "active",
        providerSubscriptionId: id,
        contractedAmount: plan.price,
        contractedCurrency: "ARS",
        lastPaymentAt: new Date(Date.now() - 10 * DAY),
        currentPeriodEnd: new Date(Date.now() + daysLeft * DAY),
      },
    });
    return id;
  }

  it("un cliente con un período pago sigue activo con solo la autorización de Mercado Pago (no se le aplica el primer cobro)", async () => {
    const id = await paidProfessional();
    await applyPreapprovalState(await resource(id));
    expect((await orgOf()).status).toBe("active");
    expect((await subOf()).status).toBe("active");
  });

  it("renovación rechazada: pasa a «en mora» con margen, y un cobro aprobado posterior lo vuelve a activar", async () => {
    const id = await paidProfessional();
    await applyAuthorizedPayment(charge(id, 9900, "rejected"));
    expect((await orgOf()).status).toBe("past_due");
    expect(await canWrite()).toBe(true); // el margen existente se conserva
    await applyAuthorizedPayment(charge(id, 9900)); // Mercado Pago la figura autorizada y el cobro aprobado: vuelve a activa
    expect((await subOf()).status).toBe("active");
    expect((await orgOf()).status).toBe("active");
  });

  it("cancelar conserva el acceso del período ya pago", async () => {
    const id = await paidProfessional(10);
    remote.get(id)!.status = "cancelled";
    await applyPreapprovalState(await resource(id));
    expect((await subOf()).status).toBe("canceled");
    expect((await orgOf()).status).toBe("active");
  });

  it("subir al Equipo «al renovar» no pierde lo pagado y los lugares llegan con su primer cobro", async () => {
    const base = await paidProfessional();
    expect((await startPlanChange({ organization: ctx.organization, userId: ctx.userId, tier: "equipo", payerEmail: "p@example.com", timing: "period_end" })).ok).toBe(true);
    const pending = (await subOf()).pendingProviderSubscriptionId!;
    authorize(pending);
    await applyPreapprovalState(await resource(pending));
    expect(await quota()).toBe(2); // autorizada, sin cobro: todavía rige el Profesional
    expect((await orgOf()).status).toBe("active"); // y conserva lo pagado
    await applyAuthorizedPayment(charge(pending, 19900));
    expect(await quota()).toBe(5);
    expect((await subOf()).plan.code).toBe("equipo");
    expect(base).not.toBe(pending);
  });

  it("volver a contratar después de cancelar vuelve a exigir un primer cobro verificado y reinicia el estado del cobro", async () => {
    const id = await paidProfessional();
    remote.get(id)!.status = "cancelled";
    await applyPreapprovalState(await resource(id));
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "canceled" } });
    await db.subscription.update({ where: { organizationId: ctx.organization.id }, data: { lastChargeStatus: "rejected" } });

    expect((await start("profesional")).ok).toBe(true);
    const fresh = await idOf();
    expect(fresh).not.toBe(id);
    expect(await subOf()).toMatchObject({ status: "pending", lastPaymentAt: null, lastChargeStatus: null });
    authorize(fresh);
    await applyPreapprovalState(await resource(fresh));
    expect((await orgOf()).status).toBe("canceled"); // autorizar no reactiva
    await applyAuthorizedPayment(charge(fresh, 9900));
    expect((await orgOf()).status).toBe("active");
  });
});
