import { createHmac } from "node:crypto";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as webhook } from "@/app/api/webhooks/mercadopago/route";
import { verifyWebhookSignature } from "@/modules/billing/mercadopago";
import { applyPreapprovalState, getMonthlyPlan, reconcileSubscriptions } from "@/modules/billing/subscriptions";
import { createSchedulableOrganization } from "./helpers";

const SECRET = "test-webhook-secret";

function sign(dataId: string, requestId: string, ts = Date.now()) {
  const v1 = createHmac("sha256", SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("Mercado Pago — firma del webhook", () => {
  it("acepta una firma válida y rechaza cualquier alteración", () => {
    const signatureHeader = sign("abc123", "req-1");
    const base = { signatureHeader, requestId: "req-1", dataId: "abc123", secret: SECRET };

    expect(verifyWebhookSignature(base)).toBe(true);
    expect(verifyWebhookSignature({ ...base, dataId: "abc124" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, requestId: "req-2" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secret: "otro-secreto" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, signatureHeader: null })).toBe(false);
    expect(verifyWebhookSignature({ ...base, signatureHeader: "ts=1,v1=zz" })).toBe(false);
  });

  it("rechaza firmas viejas (protección contra reenvíos)", () => {
    const old = Date.now() - 60 * 60 * 1000;
    expect(
      verifyWebhookSignature({ signatureHeader: sign("abc123", "req-1", old), requestId: "req-1", dataId: "abc123", secret: SECRET }),
    ).toBe(false);
  });
});

describe("suscripciones", () => {
  type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
  let ctx: Ctx;
  let preapprovalId: string;
  const eventIds: string[] = [];

  const mpFetch = (preapproval: Record<string, unknown>) =>
    vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(preapproval), { status: 200 }));

  const organization = () => db.organization.findUniqueOrThrow({ where: { id: ctx.organization.id } });
  const subscription = () => db.subscription.findUniqueOrThrow({ where: { organizationId: ctx.organization.id } });
  /** Simula que el primer cobro ya fue aprobado y verificado (eso se prueba en test/first-payment.test.ts). */
  const firstPaymentVerified = () => db.subscription.update({ where: { organizationId: ctx.organization.id }, data: { lastPaymentAt: new Date() } });

  function webhookRequest(body: Record<string, unknown>, options: { signature?: string } = {}) {
    const requestId = "req-test";
    return new Request(`http://localhost/api/webhooks/mercadopago?data.id=${preapprovalId}&type=subscription_preapproval`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-signature": options.signature ?? sign(preapprovalId, requestId),
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    ctx = await createSchedulableOrganization();
    preapprovalId = `pre${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const plan = await getMonthlyPlan();
    await db.subscription.create({
      data: { organizationId: ctx.organization.id, planId: plan.id, status: "pending", providerSubscriptionId: preapprovalId },
    });
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("MERCADOPAGO_MODE", "live");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.paymentEvent.deleteMany({ where: { providerEventId: { in: eventIds.splice(0) } } });
    await db.auditLog.deleteMany({ where: { organizationId: ctx.organization.id } });
    await ctx.cleanup();
  });

  it("una suscripción autorizada pero sin primer cobro verificado NO activa la cuenta", async () => {
    const next = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    const preapproval = { id: preapprovalId, status: "authorized", external_reference: ctx.organization.id, next_payment_date: next };

    expect(await applyPreapprovalState(preapproval)).toBe("applied");
    expect(await applyPreapprovalState(preapproval)).toBe("applied");

    expect((await organization()).status).toBe("trial");
    expect(await subscription()).toMatchObject({ status: "pending", currentPeriodEnd: null, lastPaymentAt: null });
  });

  it("con el primer cobro verificado, la autorización activa la cuenta; aplicarla dos veces no cambia nada", async () => {
    await firstPaymentVerified();
    const next = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    const preapproval = { id: preapprovalId, status: "authorized", external_reference: ctx.organization.id, next_payment_date: next };

    expect(await applyPreapprovalState(preapproval)).toBe("applied");
    expect(await applyPreapprovalState(preapproval)).toBe("applied");

    expect((await organization()).status).toBe("active");
    const sub = await subscription();
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd?.toISOString()).toBe(next);
  });

  it("ignora suscripciones que no iniciamos (otro id para la misma organización)", async () => {
    const result = await applyPreapprovalState({ id: "preapproval-ajeno", status: "authorized", external_reference: ctx.organization.id });
    expect(result).toBe("ignored");
    expect((await organization()).status).toBe("trial");
  });

  it("al cancelar se respeta el período ya pago; vencido ese período la cuenta queda cancelada", async () => {
    const future = new Date(Date.now() + 10 * 24 * 3600000).toISOString();
    await firstPaymentVerified();
    await applyPreapprovalState({ id: preapprovalId, status: "authorized", next_payment_date: future });
    await applyPreapprovalState({ id: preapprovalId, status: "cancelled", next_payment_date: future });

    expect((await subscription()).status).toBe("canceled");
    expect((await organization()).status).toBe("active");

    await db.subscription.update({
      where: { organizationId: ctx.organization.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    await reconcileSubscriptions();
    expect((await organization()).status).toBe("canceled");
  });

  it("una cuenta suspendida por la plataforma no se reactiva por un pago", async () => {
    await db.organization.update({ where: { id: ctx.organization.id }, data: { status: "suspended" } });
    await applyPreapprovalState({ id: preapprovalId, status: "authorized" });
    expect((await organization()).status).toBe("suspended");
  });

  it("webhook: rechaza firmas inválidas sin tocar nada", async () => {
    const fetchSpy = mpFetch({ id: preapprovalId, status: "authorized" });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await webhook(webhookRequest({ id: "evt-x", type: "subscription_preapproval" }, { signature: "ts=1,v1=" + "0".repeat(64) }));

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await organization()).status).toBe("trial");
  });

  it("webhook: activa con el estado consultado a la API (no con el cuerpo) y es idempotente", async () => {
    await firstPaymentVerified();
    const eventId = `evt-${preapprovalId}`;
    eventIds.push(eventId);
    const fetchSpy = mpFetch({ id: preapprovalId, status: "authorized", external_reference: ctx.organization.id });
    vi.stubGlobal("fetch", fetchSpy);

    // El cuerpo "miente" (dice cancelled): debe ganar lo que responde la API.
    const body = { id: eventId, type: "subscription_preapproval", action: "updated", data: { id: preapprovalId }, status: "cancelled" };

    const first = await webhook(webhookRequest(body));
    expect(first.status).toBe(200);
    expect((await organization()).status).toBe("active");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await webhook(webhookRequest(body));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await db.paymentEvent.count({ where: { providerEventId: eventId } })).toBe(1);
  });

  it("webhook: si Mercado Pago no responde, devuelve 500 y el evento queda pendiente para reintentar", async () => {
    const eventId = `evt-fail-${preapprovalId}`;
    eventIds.push(eventId);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const body = { id: eventId, type: "subscription_preapproval", data: { id: preapprovalId } };

    const failed = await webhook(webhookRequest(body));
    expect(failed.status).toBe(500);
    const stored = await db.paymentEvent.findFirstOrThrow({ where: { providerEventId: eventId } });
    expect(stored.processedAt).toBeNull();
    expect(stored.error).toContain("503");
    expect((await organization()).status).toBe("trial");

    // El reintento de Mercado Pago, ya con la API disponible, lo procesa.
    await firstPaymentVerified();
    vi.stubGlobal("fetch", mpFetch({ id: preapprovalId, status: "authorized" }));
    const retried = await webhook(webhookRequest(body));
    expect(retried.status).toBe(200);
    expect((await organization()).status).toBe("active");
  });
});

describe("webhook — avisos sobre recursos que no son nuestros (p. ej. «Simular notificación»)", () => {
  const unknownId = "123456";

  function signedRequest(type: string, dataId: string, eventId: string) {
    const requestId = `req-${Math.random().toString(36).slice(2, 8)}`;
    return new Request(`http://localhost/api/webhooks/mercadopago?data.id=${dataId}&type=${type}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": sign(dataId, requestId) },
      body: JSON.stringify({ action: "updated", application_id: "1", data: { id: dataId }, date: "2021-11-01T02:02:02Z", entity: "preapproval", id: eventId, type, version: 8 }),
    });
  }

  const eventId = `evt-sim-${Date.now()}`;
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.paymentEvent.deleteMany({ where: { providerEventId: { startsWith: "evt-sim-" } } });
  });

  function configure() {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("MERCADOPAGO_MODE", "live");
  }

  it("una suscripción desconocida se ignora de forma explícita: 200, registrada como ignorada y sin consultar a Mercado Pago", async () => {
    configure();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ message: "Preapproval not found", status: 404 }), { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    const response = await webhook(signedRequest("subscription_preapproval", unknownId, eventId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ignored: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    const stored = await db.paymentEvent.findFirstOrThrow({ where: { providerEventId: eventId } });
    expect(stored.processedAt).not.toBeNull();
    expect(stored.error).toContain("ignorado: suscripción desconocida");
  });

  it("un cobro que Mercado Pago dice que no existe se ignora y queda registrado", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "not found", status: 404 }), { status: 404 })));
    const response = await webhook(signedRequest("subscription_authorized_payment", unknownId, `${eventId}-ap`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: true });
    expect((await db.paymentEvent.findFirstOrThrow({ where: { providerEventId: `${eventId}-ap` } })).error).toContain("ignorado: cobro inexistente");
  });

  it("un pago que Mercado Pago dice que no existe se ignora; un fallo real de la API sigue devolviendo 500 para que reintente", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect((await webhook(signedRequest("payment", unknownId, `${eventId}-pay`))).status).toBe(200);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect((await webhook(signedRequest("payment", "98765", `${eventId}-pay2`))).status).toBe(500);
  });

  it("la firma sigue siendo obligatoria: el mismo aviso sin firma válida es 401 y no se registra", async () => {
    configure();
    const request = signedRequest("subscription_preapproval", unknownId, `${eventId}-bad`);
    const forged = new Request(request.url, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "r", "x-signature": "ts=1,v1=" + "0".repeat(64) }, body: await request.text() });
    expect((await webhook(forged)).status).toBe(401);
    expect(await db.paymentEvent.count({ where: { providerEventId: `${eventId}-bad` } })).toBe(0);
  });
});

describe("webhook — entregas simultáneas del mismo evento", () => {
  it("diez entregas a la vez del mismo evento responden 200, sin errores 500, y dejan un solo registro", async () => {
    const preapprovalId = `pre${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const eventId = `evt-${preapprovalId}`;
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("MERCADOPAGO_MODE", "live");
    // El recurso no pertenece a ninguna suscripción nuestra: se ignora, pero el evento se registra igual.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: preapprovalId, status: "pending" }), { status: 200 })));
    try {
      const deliver = () => {
        const requestId = `req-${Math.random().toString(36).slice(2, 8)}`;
        return webhook(
          new Request(`http://localhost/api/webhooks/mercadopago?data.id=${preapprovalId}&type=subscription_preapproval`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": sign(preapprovalId, requestId) },
            body: JSON.stringify({ id: eventId, type: "subscription_preapproval", data: { id: preapprovalId } }),
          }),
        );
      };
      const responses = await Promise.all(Array.from({ length: 10 }, deliver));
      expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(await db.paymentEvent.count({ where: { providerEventId: eventId } })).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await db.paymentEvent.deleteMany({ where: { providerEventId: eventId } });
    }
  });
});
