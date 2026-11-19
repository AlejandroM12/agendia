import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { applyAuthorizedPayment, applyPreapprovalState, processPaymentEvent, reconcileSubscriptions } from "@/modules/billing/subscriptions";
import { previewPlanChange, startPlanChange } from "@/modules/billing/plan-change";
import { ensurePlan } from "@/modules/billing/catalog";
import { getProfessionalQuota } from "@/modules/team/professionals";
import { addProfessional, createSchedulableOrganization, enableTeam, refreshOrganization } from "./helpers";

/**
 * Contratación y cambios de plan con Mercado Pago SIMULADO (fetch reemplazado): verifican nuestra
 * lógica (identificación, importes, idempotencia, orden de eventos, cupos), no la API real, que
 * todavía no se probó contra el sandbox (docs/MERCADOPAGO.md).
 */

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
type Remote = { id: string; status: string; external_reference?: string; amount: number; currency?: string; next?: string };

let ctx: Ctx;
let calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
let remote: Map<string, Remote>;
/** Cobros que «tiene» Mercado Pago por suscripción (para la búsqueda de cobros de la conciliación). */
let charges: Map<string, Array<Record<string, unknown>>>;
let counter = 0;

function installMercadoPago() {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
  vi.stubEnv("MERCADOPAGO_MODE", "live");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method, path, body });
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
      if (method === "POST" && path === "/preapproval") {
        const id = `pre-${++counter}-${Date.now()}`;
        const recurring = body!.auto_recurring as { transaction_amount: number; currency_id: string };
        remote.set(id, {
          id,
          status: "pending",
          external_reference: String(body!.external_reference),
          amount: recurring.transaction_amount,
          currency: recurring.currency_id,
          next: new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
        });
        return json({ id, init_point: `https://mp.test/checkout/${id}`, status: "pending" });
      }
      if (method === "GET" && path === "/authorized_payments/search") {
        const id = new URL(url).searchParams.get("preapproval_id") ?? "";
        return json({ results: charges.get(id) ?? [] });
      }
      const match = path.match(/^\/preapproval\/(.+)$/);
      if (match) {
        const item = remote.get(decodeURIComponent(match[1]));
        if (!item) return new Response("{}", { status: 404 });
        if (method === "PUT" && body?.status) item.status = String(body.status);
        return json({
          id: item.id,
          status: item.status,
          external_reference: item.external_reference,
          next_payment_date: item.next,
          auto_recurring: { transaction_amount: item.amount, currency_id: item.currency ?? "ARS" },
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

const authorize = (id: string) => {
  remote.get(id)!.status = "authorized";
};
const org = () => refreshOrganization(ctx.organization.id);
const sub = () => db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id }, include: { plan: true } });
const preapprovalOf = async (id: string) => (await import("@/modules/billing/mercadopago")).getPreapproval(id);
const payment = (preapprovalId: string, amount: number, status = "approved") => ({
  id: `pay-${++counter}`,
  preapproval_id: preapprovalId,
  transaction_amount: amount,
  currency_id: "ARS",
  payment: { id: counter, status },
});

/** Negocio con Plan Profesional vigente y pagado. */
async function paidProfessional() {
  const plan = await ensurePlan("profesional");
  const id = `pre-base-${++counter}-${Date.now()}`;
  remote.set(id, { id, status: "authorized", external_reference: ctx.organization.id, amount: plan.price, next: new Date(Date.now() + 20 * 24 * 3600000).toISOString() });
  await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "active", teamModeEnabled: true } });
  await db.subscription.create({
    data: {
      organizationId: ctx.organization.id,
      planId: plan.id,
      status: "active",
      providerSubscriptionId: id,
      contractedAmount: plan.price,
      contractedCurrency: "ARS",
      lastPaymentAt: new Date(),
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600000),
    },
  });
  return id;
}

beforeEach(async () => {
  ctx = await createSchedulableOrganization();
  calls = [];
  remote = new Map();
  charges = new Map();
  installMercadoPago();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { organizationId: ctx.organization.id } });
  await db.subscription.deleteMany({ where: { organizationId: ctx.organization.id } });
  await ctx.cleanup();
});

const start = (tier: "profesional" | "equipo", extra: { keepIds?: string[]; timing?: "now" | "period_end" } = {}) =>
  startPlanChange({ organization: ctx.organization, userId: ctx.userId, tier, payerEmail: "pagador@example.com", ...extra });

describe("contratar un plan", () => {
  it("envía a Mercado Pago el importe y la moneda del plan, identifica la organización y no activa nada", async () => {
    const result = await start("equipo");
    expect(result.ok).toBe(true);

    const create = calls.find((call) => call.method === "POST" && call.path === "/preapproval")!;
    expect(create.body).toMatchObject({
      external_reference: ctx.organization.id,
      payer_email: "pagador@example.com",
      status: "pending",
      auto_recurring: { transaction_amount: 19900, currency_id: "ARS", frequency: 1, frequency_type: "months" },
    });
    expect(JSON.stringify(create.body)).not.toMatch(/card|token|cvv/i);

    const stored = await sub();
    expect(stored).toMatchObject({ status: "pending", contractedAmount: 19900, contractedCurrency: "ARS" });
    expect(stored.plan.code).toBe("equipo");
    // Todavía no es suscriptor: la cuenta sigue en prueba y los cupos son los de la prueba.
    expect((await org()).status).toBe("trial");
    expect((await getProfessionalQuota(db, await org())).limit).toBe(2);
  });

  it("autorizar sin un cobro aprobado activa la cuenta pero NO los 5 cupos del Plan Equipo", async () => {
    await start("equipo");
    const id = (await sub()).providerSubscriptionId!;
    authorize(id);
    expect(await applyPreapprovalState(await preapprovalOf(id))).toBe("applied");

    expect((await org()).status).toBe("active");
    expect((await getProfessionalQuota(db, await org())).limit).toBe(2);

    await applyAuthorizedPayment(payment(id, 19900));
    expect((await getProfessionalQuota(db, await org()))).toMatchObject({ limit: 5, tier: "equipo" });
  });

  it("rechaza un importe distinto del contratado y no lo aplica", async () => {
    await start("equipo");
    const id = (await sub()).providerSubscriptionId!;
    authorize(id);
    remote.get(id)!.amount = 9900;
    expect(await applyPreapprovalState(await preapprovalOf(id))).toBe("rejected");
    expect((await org()).status).toBe("trial");
    expect(await db.auditLog.count({ where: { organizationId: ctx.organization.id, action: "subscription.rejected_amount_mismatch" } })).toBe(1);
  });

  it("rechaza una suscripción cuyo external_reference es de otra organización", async () => {
    await start("profesional");
    const id = (await sub()).providerSubscriptionId!;
    authorize(id);
    remote.get(id)!.external_reference = "otra-organizacion";
    expect(await applyPreapprovalState(await preapprovalOf(id))).toBe("rejected");
    expect((await org()).status).toBe("trial");
  });

  it("un cobro aprobado con otro importe no habilita nada", async () => {
    await start("equipo");
    const id = (await sub()).providerSubscriptionId!;
    authorize(id);
    await applyAuthorizedPayment(payment(id, 100));
    expect((await sub()).lastPaymentAt).toBeNull();
    expect((await getProfessionalQuota(db, await org())).limit).toBe(2);
  });

  it("pendiente, rechazado y duplicados: el estado siempre sale del recurso consultado", async () => {
    await start("profesional");
    const id = (await sub()).providerSubscriptionId!;
    expect(await applyPreapprovalState(await preapprovalOf(id))).toBe("applied"); // pending
    expect((await sub()).status).toBe("pending");
    authorize(id);
    for (let i = 0; i < 3; i++) await applyPreapprovalState(await preapprovalOf(id)); // eventos repetidos
    expect((await sub()).status).toBe("active");
    await applyAuthorizedPayment(payment(id, 9900, "rejected"));
    expect((await org()).status).toBe("past_due");
    // Un evento atrasado de "authorized" no puede dejar sin efecto el estado real de Mercado Pago.
    remote.get(id)!.status = "paused";
    await applyPreapprovalState(await preapprovalOf(id));
    expect((await sub()).status).toBe("paused");
  });

  it("un cobro de un recurso que no iniciamos se ignora", async () => {
    remote.set("ajeno", { id: "ajeno", status: "authorized", external_reference: ctx.organization.id, amount: 9900 });
    expect(await applyPreapprovalState(await preapprovalOf("ajeno"))).toBe("ignored");
    await processPaymentEvent({ type: "subscription_preapproval", resourceId: "ajeno" });
    expect(await db.subscription.count({ where: { organizationId: ctx.organization.id } })).toBe(0);
  });
});

describe("conciliación de cobros cuyo aviso se perdió", () => {
  const ageSubscription = () => db.subscription.update({ where: { organizationId: ctx.organization.id }, data: { updatedAt: new Date(Date.now() - 7 * 3600000) } });

  it("un cambio «hoy» cuyo primer cobro aprobado no avisó se hace efectivo al conciliar, una sola vez", async () => {
    const base = await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    charges.set(pending, [payment(pending, 19900)]); // Mercado Pago cobró, pero el webhook nunca llegó

    await ageSubscription();
    await reconcileSubscriptions();
    await ageSubscription();
    await reconcileSubscriptions(); // otra vuelta: no repite nada

    const stored = await sub();
    expect(stored).toMatchObject({ pendingProviderSubscriptionId: null, contractedAmount: 19900 });
    expect(stored.plan.code).toBe("equipo");
    expect(await getProfessionalQuota(db, await org())).toMatchObject({ limit: 5, tier: "equipo" });
    expect(remote.get(base)!.status).toBe("cancelled");
    expect(await db.auditLog.count({ where: { organizationId: ctx.organization.id, action: "subscription.plan_changed" } })).toBe(1);
  });

  it("un cobro con otro importe encontrado al conciliar no promueve nada", async () => {
    await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    charges.set(pending, [payment(pending, 100)]);
    await ageSubscription();
    await reconcileSubscriptions();
    expect((await sub()).pendingProviderSubscriptionId).toBe(pending);
  });

  it("un cobro rechazado encontrado al conciliar no promueve nada", async () => {
    await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    charges.set(pending, [payment(pending, 19900, "rejected")]);
    await ageSubscription();
    await reconcileSubscriptions();
    expect((await sub()).pendingProviderSubscriptionId).toBe(pending);
  });

  it("una suscripción nueva con un primer cobro aprobado sin aviso queda con el pago verificado", async () => {
    const result = await start("profesional");
    expect(result.ok).toBe(true);
    const id = (await sub()).providerSubscriptionId!;
    authorize(id);
    charges.set(id, [payment(id, 9900)]);
    await ageSubscription();
    await reconcileSubscriptions();
    const stored = await sub();
    expect(stored.status).toBe("active");
    expect(stored.lastPaymentAt).not.toBeNull();
  });
});

describe("Profesional → Equipo", () => {
  it("el cambio queda pendiente: volver de la pantalla de pago o autorizar no da los cupos", async () => {
    const base = await paidProfessional();
    const preview = await previewPlanChange(await org(), "equipo", new Date(), "now");
    expect(preview).toMatchObject({
      kind: "upgrade",
      current: { name: "Plan Profesional", price: 9900, capacity: 2 },
      target: { name: "Plan Equipo", price: 19900, capacity: 5 },
      amountToday: 19900,
      effective: "al aprobarse el pago",
    });

    expect((await start("equipo", { timing: "now" })).ok).toBe(true);
    const pending = (await sub()).pendingProviderSubscriptionId!;
    expect(pending).toBeTruthy();
    authorize(pending);
    await applyPreapprovalState(await preapprovalOf(pending));

    const stored = await sub();
    expect(stored.plan.code).toBe("mensual");
    expect(stored.providerSubscriptionId).toBe(base);
    expect((await getProfessionalQuota(db, await org())).limit).toBe(2);
    // No se canceló nada de lo vigente.
    expect(calls.some((call) => call.method === "PUT" && call.path.endsWith(base))).toBe(false);
  });

  it("con el primer cobro aprobado pasa a regir el Plan Equipo y se cancela el anterior, una sola vez", async () => {
    const base = await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);

    await applyAuthorizedPayment(payment(pending, 19900));
    await applyAuthorizedPayment(payment(pending, 19900)); // duplicado

    const stored = await sub();
    expect(stored).toMatchObject({ pendingProviderSubscriptionId: null, providerSubscriptionId: pending, contractedAmount: 19900, retiredProviderSubscriptionId: null });
    expect(stored.plan.code).toBe("equipo");
    expect((await getProfessionalQuota(db, await org()))).toMatchObject({ limit: 5, tier: "equipo" });
    expect(remote.get(base)!.status).toBe("cancelled");
    expect(calls.filter((call) => call.method === "PUT" && call.path.endsWith(base))).toHaveLength(1);
    expect(await db.auditLog.count({ where: { organizationId: ctx.organization.id, action: "subscription.plan_changed" } })).toBe(1);
  });

  it("un cobro que llega antes de que la suscripción figure autorizada no cambia el plan", async () => {
    await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!; // sigue "pending" en Mercado Pago
    await applyAuthorizedPayment(payment(pending, 19900));
    expect((await sub()).plan.code).toBe("mensual");
    // Cuando llega la autorización y se repite el cobro, recién entonces se aplica (eventos desordenados).
    authorize(pending);
    await applyAuthorizedPayment(payment(pending, 19900));
    expect((await sub()).plan.code).toBe("equipo");
  });

  it("un cobro con importe del plan equivocado no promueve el cambio", async () => {
    await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    await applyAuthorizedPayment(payment(pending, 9900));
    expect((await sub()).plan.code).toBe("mensual");
  });

  it("si Mercado Pago no puede cancelar la anterior, queda marcada para reintentar y no se pierde", async () => {
    const base = await paidProfessional();
    await start("equipo", { timing: "now" });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) =>
      init?.method === "PUT" ? new Response("boom", { status: 500 }) : original(url, init),
    );
    await applyAuthorizedPayment(payment(pending, 19900));
    expect((await sub()).retiredProviderSubscriptionId).toBe(base);

    fetchMock.mockImplementation(original);
    const { cancelRetiredSubscriptions } = await import("@/modules/billing/subscriptions");
    expect(await cancelRetiredSubscriptions()).toMatchObject({ canceled: expect.any(Number) });
    expect((await sub()).retiredProviderSubscriptionId).toBeNull();
    expect(remote.get(base)!.status).toBe("cancelled");
  });

  it("no hay dos cambios a la vez: pedir otro descarta (cancela) el anterior sin tocar lo vigente", async () => {
    const base = await paidProfessional();
    await start("equipo", { timing: "now" });
    const first = (await sub()).pendingProviderSubscriptionId!;
    await start("equipo", { timing: "now" });
    const second = (await sub()).pendingProviderSubscriptionId!;
    expect(second).not.toBe(first);
    expect(remote.get(first)!.status).toBe("cancelled");
    expect((await sub()).providerSubscriptionId).toBe(base);
  });

  it("pedir el plan que ya se tiene no hace nada", async () => {
    await paidProfessional();
    expect(await start("profesional")).toMatchObject({ ok: false });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("no se vende si el precio contratable difiere del publicado", async () => {
    await db.plan.update({ where: { code: "equipo" }, data: { price: 15000 } });
    try {
      expect(await start("equipo", { timing: "now" })).toMatchObject({ ok: false });
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    } finally {
      await db.plan.update({ where: { code: "equipo" }, data: { price: 19900 } });
    }
  });
});

describe("Equipo → Profesional", () => {
  async function paidTeam(professionals = 4) {
    const plan = await ensurePlan("equipo");
    const id = `pre-team-${++counter}-${Date.now()}`;
    remote.set(id, { id, status: "authorized", external_reference: ctx.organization.id, amount: plan.price, next: new Date(Date.now() + 10 * 24 * 3600000).toISOString() });
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "active", teamModeEnabled: true } });
    await db.subscription.create({
      data: {
        organizationId: ctx.organization.id,
        planId: plan.id,
        status: "active",
        providerSubscriptionId: id,
        contractedAmount: plan.price,
        contractedCurrency: "ARS",
        lastPaymentAt: new Date(),
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600000),
      },
    });
    await enableTeam(ctx.organization.id);
    const extra = [];
    for (let i = 1; i < professionals; i++) extra.push(await addProfessional(ctx.organization.id, { displayName: `Pro ${i + 1}` }));
    return { id, extra };
  }

  it("informa qué se reduce, lista a los profesionales y programa el cambio al fin del período pago", async () => {
    await paidTeam(4);
    const preview = await previewPlanChange(await org(), "profesional");
    expect(preview).toMatchObject({ kind: "downgrade", amountToday: 0, effective: "al finalizar el período ya pago" });
    expect(preview.reduction).toMatchObject({ newLimit: 2, active: 4, excess: 2, graceDays: 7 });
    expect(preview.reduction!.professionals).toHaveLength(4);
    expect(preview.reduction!.professionals.filter((p) => p.keep)).toHaveLength(2);

    const result = await start("profesional");
    expect(result.ok).toBe(true);
    const create = calls.find((call) => call.method === "POST")!;
    expect((create.body!.auto_recurring as { start_date?: string }).start_date).toBeTruthy();
    expect((await sub()).pendingKind).toBe("downgrade");
  });

  it("al autorizarse la nueva se cancela la de Equipo, y el Equipo rige hasta el último día pago", async () => {
    const { id } = await paidTeam(4);
    await start("profesional");
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    await applyPreapprovalState(await preapprovalOf(pending));

    expect(remote.get(id)!.status).toBe("cancelled");
    await applyPreapprovalState(await preapprovalOf(id)); // llega la baja de la anterior
    const stored = await sub();
    expect(stored.plan.code).toBe("equipo");
    expect(stored.status).toBe("canceled");
    expect((await org()).status).toBe("active");
    // Sigue pagado hasta fin de período: los 5 cupos se mantienen y no hay exceso todavía.
    expect((await getProfessionalQuota(db, await org())).limit).toBe(5);
  });

  it("al cobrarse el primer período del Profesional empieza la adaptación sin borrar ni desactivar a nadie", async () => {
    const { id, extra } = await paidTeam(4);
    await start("profesional", { keepIds: [(await db.professional.findFirstOrThrow({ where: { organizationId: ctx.organization.id }, orderBy: { createdAt: "asc" } })).id, extra[0].id] });
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    await applyPreapprovalState(await preapprovalOf(pending));
    await applyPreapprovalState(await preapprovalOf(id));
    await applyAuthorizedPayment(payment(pending, 9900));

    const stored = await sub();
    expect(stored).toMatchObject({ pendingProviderSubscriptionId: null, providerSubscriptionId: pending, contractedAmount: 9900 });
    expect(stored.plan.code).toBe("mensual");
    const organization = await org();
    expect(organization.status).toBe("active");
    expect(organization.capacityGraceStartedAt).not.toBeNull();
    const days = (organization.capacityGraceEndsAt!.getTime() - organization.capacityGraceStartedAt!.getTime()) / 86400000;
    expect(days).toBeCloseTo(7, 5);
    expect(await db.professional.count({ where: { organizationId: ctx.organization.id, active: true } })).toBe(4);
    // Mientras haya exceso no se puede agregar ni reactivar.
    expect((await getProfessionalQuota(db, organization))).toMatchObject({ limit: 2, active: 4, overLimit: true, canAdd: false });
  });

  it("recontratar el Plan Equipo devuelve el cupo completo y cierra la adaptación", async () => {
    const { id } = await paidTeam(4);
    await start("profesional");
    const pending = (await sub()).pendingProviderSubscriptionId!;
    authorize(pending);
    await applyPreapprovalState(await preapprovalOf(pending));
    await applyPreapprovalState(await preapprovalOf(id));
    await applyAuthorizedPayment(payment(pending, 9900));
    expect((await org()).capacityGraceStartedAt).not.toBeNull();

    await start("equipo", { timing: "now" });
    const again = (await sub()).pendingProviderSubscriptionId!;
    authorize(again);
    await applyAuthorizedPayment(payment(again, 19900));

    expect((await getProfessionalQuota(db, await org()))).toMatchObject({ limit: 5, overLimit: false });
    const organization = await org();
    expect(organization.capacityGraceStartedAt).toBeNull();
    expect(organization.capacityGraceEndsAt).toBeNull();
  });
});

describe("Profesional → Equipo al terminar el período ya pago (recomendado)", () => {
  it("no pierde lo abonado: la nueva empieza a cobrar al renovar, la anterior se cancela al autorizarla y los lugares llegan con el primer cobro", async () => {
    const base = await paidProfessional();
    const preview = await previewPlanChange(await org(), "equipo");
    expect(preview).toMatchObject({ kind: "upgrade", amountToday: 0, effective: "al finalizar el período ya pago" });
    expect(preview.effectiveAt).toBeInstanceOf(Date);

    expect((await start("equipo")).ok).toBe(true);
    const create = calls.find((call) => call.method === "POST" && call.path === "/preapproval")!;
    expect((create.body!.auto_recurring as { start_date?: string }).start_date).toBeTruthy();
    const pending = (await sub()).pendingProviderSubscriptionId!;
    expect((await sub()).pendingEffectiveAt).not.toBeNull();

    authorize(pending);
    await applyPreapprovalState(await preapprovalOf(pending));
    // Al autorizarse (todavía sin cobrar) se cancela la anterior, antes de su próximo cobro.
    expect(remote.get(base)!.status).toBe("cancelled");
    expect((await getProfessionalQuota(db, await org())).limit).toBe(2); // los 5 lugares todavía no

    await applyAuthorizedPayment(payment(pending, 19900));
    expect((await sub()).plan.code).toBe("equipo");
    expect((await getProfessionalQuota(db, await org()))).toMatchObject({ limit: 5, tier: "equipo" });
  });

  it("«hoy» sigue disponible, cobra el Equipo ya y lo avisa", async () => {
    await paidProfessional();
    const now = await previewPlanChange(await org(), "equipo", new Date(), "now");
    expect(now).toMatchObject({ amountToday: 19900, effective: "al aprobarse el pago", effectiveAt: null });
  });
});
