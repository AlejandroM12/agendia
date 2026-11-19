import { createHmac } from "node:crypto";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { pricing } from "@/lib/brand";
import { POST as webhook } from "@/app/api/webhooks/mercadopago/route";
import {
  applyLicensePayment,
  createLicenseOrder,
  licenseReference,
  reconcileLicenseOrders,
  syncLicenseOrder,
} from "@/modules/billing/licenses";
import { uniqueSuffix } from "./helpers";

const SECRET = "test-webhook-secret";

describe("compra de la licencia independiente", () => {
  const orderIds: string[] = [];
  const eventIds: string[] = [];
  let suffix: string;

  const buyer = () => ({
    name: "Lía Licencia",
    email: `licencia-${suffix}@example.com`,
    businessName: `Estudio ${suffix}`,
    phone: undefined,
  });

  /** Responde según el servicio al que se llama: Mercado Pago o Resend. */
  function stubFetch(mercadoPago: unknown, status = 200) {
    const spy = vi.fn(async (url: unknown, _init?: RequestInit) =>
      String(url).startsWith("https://api.resend.com")
        ? new Response("{}", { status: 200 })
        : String(url).endsWith("/users/me")
          ? new Response(JSON.stringify({ tags: [] }), { status: 200 }) // cuenta de producción
          : new Response(JSON.stringify(mercadoPago), { status }),
    );
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  const emailsSent = (spy: ReturnType<typeof stubFetch>) =>
    spy.mock.calls
      .filter(([url]) => String(url).startsWith("https://api.resend.com"))
      .map(([, init]) => JSON.parse(String(init?.body)) as { to: string[]; subject: string });

  async function pendingOrder() {
    const order = await db.licenseOrder.create({
      data: { ...buyer(), amount: pricing.oneTime, currency: pricing.currency, providerPreferenceId: `pref-${suffix}` },
    });
    orderIds.push(order.id);
    return order;
  }

  const payment = (orderId: string, overrides: Record<string, unknown> = {}) => ({
    id: `pay-${suffix}`,
    status: "approved",
    external_reference: licenseReference(orderId),
    transaction_amount: pricing.oneTime,
    currency_id: pricing.currency,
    date_approved: new Date().toISOString(),
    ...overrides,
  });

  const stored = (id: string) => db.licenseOrder.findUniqueOrThrow({ where: { id } });

  beforeEach(() => {
    suffix = uniqueSuffix();
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("MERCADOPAGO_MODE", "live");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Agendia <turnos@example.com>");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.paymentEvent.deleteMany({ where: { providerEventId: { in: eventIds.splice(0) } } });
    await db.auditLog.deleteMany({ where: { entityType: "license_order", entityId: { in: orderIds } } });
    await db.licenseOrder.deleteMany({ where: { OR: [{ id: { in: orderIds.splice(0) } }, { email: buyer().email }] } });
  });

  it("crea la orden pendiente con el precio vigente y devuelve el checkout de Mercado Pago", async () => {
    const spy = stubFetch({ id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" });

    const result = await createLicenseOrder(buyer());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    orderIds.push(result.orderId);
    expect(result.checkoutUrl).toContain("pref-1");
    expect(await stored(result.orderId)).toMatchObject({
      status: "pending",
      amount: pricing.oneTime,
      providerPreferenceId: "pref-1",
      paidAt: null,
    });

    const body = JSON.parse(String(spy.mock.calls.find(([url]) => !String(url).endsWith("/users/me"))?.[1]?.body));
    expect(body.external_reference).toBe(licenseReference(result.orderId));
    expect(body.items[0]).toMatchObject({ quantity: 1, unit_price: pricing.oneTime, currency_id: "ARS" });
    expect(emailsSent(spy)).toHaveLength(0); // crear la orden no avisa nada: todavía no hay pago
  });

  it("sin Mercado Pago configurado no crea órdenes", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    const result = await createLicenseOrder(buyer());
    expect(result.ok).toBe(false);
    expect(await db.licenseOrder.count({ where: { email: buyer().email } })).toBe(0);
  });

  it("si Mercado Pago falla al crear el checkout, no queda una orden huérfana", async () => {
    stubFetch({ message: "error" }, 500);
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await createLicenseOrder(buyer());
    silenced.mockRestore();

    expect(result.ok).toBe(false);
    expect(await db.licenseOrder.count({ where: { email: buyer().email } })).toBe(0);
  });

  it("un pago aprobado marca la orden como pagada y avisa una sola vez, aunque se aplique dos veces", async () => {
    const order = await pendingOrder();
    const spy = stubFetch({});

    expect(await applyLicensePayment(payment(order.id))).toBe("applied");
    expect(await applyLicensePayment(payment(order.id))).toBe("ignored");

    expect(await stored(order.id)).toMatchObject({ status: "paid", providerPaymentId: `pay-${suffix}` });
    expect((await stored(order.id)).paidAt).toBeInstanceOf(Date);
    const emails = emailsSent(spy);
    expect(emails).toHaveLength(2);
    expect(emails[0].to).toEqual([order.email]);
  });

  it("no acepta un pago por menos del precio ni en otra moneda", async () => {
    const order = await pendingOrder();
    stubFetch({});
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await applyLicensePayment(payment(order.id, { transaction_amount: 100 }))).toBe("ignored");
    expect(await applyLicensePayment(payment(order.id, { currency_id: "USD" }))).toBe("ignored");
    silenced.mockRestore();

    expect((await stored(order.id)).status).toBe("pending");
  });

  it("un rechazo no cierra la orden: un intento posterior aprobado la paga", async () => {
    const order = await pendingOrder();
    stubFetch({});

    expect(await applyLicensePayment(payment(order.id, { id: "pay-a", status: "rejected" }))).toBe("applied");
    expect((await stored(order.id)).status).toBe("rejected");

    expect(await applyLicensePayment(payment(order.id, { id: "pay-b" }))).toBe("applied");
    expect(await stored(order.id)).toMatchObject({ status: "paid", providerPaymentId: "pay-b" });

    // Un rechazo que llega tarde no deshace un pago aprobado.
    expect(await applyLicensePayment(payment(order.id, { id: "pay-a", status: "rejected" }))).toBe("ignored");
    expect((await stored(order.id)).status).toBe("paid");
  });

  it("una devolución del pago registrado marca la orden como devuelta", async () => {
    const order = await pendingOrder();
    stubFetch({});
    await applyLicensePayment(payment(order.id));

    expect(await applyLicensePayment(payment(order.id, { id: "otro-pago", status: "refunded" }))).toBe("ignored");
    expect(await applyLicensePayment(payment(order.id, { status: "refunded" }))).toBe("applied");
    expect((await stored(order.id)).status).toBe("refunded");
  });

  it("ignora pagos que no son de una licencia (por ejemplo, el cobro de una suscripción)", async () => {
    const order = await pendingOrder();
    expect(await applyLicensePayment(payment(order.id, { external_reference: order.id }))).toBe("ignored");
    expect(await applyLicensePayment(payment(order.id, { external_reference: "license:no-existe" }))).toBe("ignored");
    expect((await stored(order.id)).status).toBe("pending");
  });

  it("al volver del checkout el estado sale de la API: un pago aprobado manda sobre un rechazo anterior", async () => {
    const order = await pendingOrder();
    stubFetch({ results: [payment(order.id, { id: "pay-2", status: "rejected" }), payment(order.id, { id: "pay-1" })] });

    await syncLicenseOrder(order.id);

    expect(await stored(order.id)).toMatchObject({ status: "paid", providerPaymentId: "pay-1" });
  });

  it("la reconciliación resuelve órdenes cuyo webhook nunca llegó", async () => {
    const order = await pendingOrder();
    await db.$executeRaw`UPDATE "license_orders" SET "updatedAt" = now() - interval '2 hours' WHERE "id" = ${order.id}`;
    stubFetch({ results: [payment(order.id)] });

    const result = await reconcileLicenseOrders(200);

    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect((await stored(order.id)).status).toBe("paid");
  });

  it("webhook de pago: paga la orden con lo que responde la API y las entregas repetidas no repiten nada", async () => {
    const order = await pendingOrder();
    const paymentId = `${Date.now()}`;
    const eventId = `evt-license-${suffix}`;
    eventIds.push(eventId);
    const spy = stubFetch(payment(order.id, { id: paymentId }));

    const request = () => {
      const ts = Date.now();
      const v1 = createHmac("sha256", SECRET).update(`id:${paymentId};request-id:req-lic;ts:${ts};`).digest("hex");
      return new Request(`http://localhost/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "req-lic", "x-signature": `ts=${ts},v1=${v1}` },
        // El cuerpo no dice nada del estado: se consulta siempre a la API.
        body: JSON.stringify({ id: eventId, type: "payment", action: "payment.updated", data: { id: paymentId } }),
      });
    };

    expect((await webhook(request())).status).toBe(200);
    expect(await stored(order.id)).toMatchObject({ status: "paid", providerPaymentId: paymentId });

    const second = await webhook(request());
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(emailsSent(spy)).toHaveLength(2);
    expect(await db.paymentEvent.count({ where: { providerEventId: eventId } })).toBe(1);
  });
});
