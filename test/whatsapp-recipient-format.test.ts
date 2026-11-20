import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { canonicalInboundNumber } from "@/lib/phone";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createAppointment } from "@/modules/appointments/service";
import { createDemoWorkspace } from "@/modules/demo/workspace";
import { processDueNotifications } from "@/modules/notifications/process";
import { recipientFormatFor, sendSessionReply, usesMetaTestNumber } from "@/modules/whatsapp/service";
import { createSchedulableOrganization } from "./helpers";
import { connectWhatsapp, fakeMeta, stubWhatsappEnv } from "./whatsapp-helpers";

/**
 * A qué formato se le entrega el destinatario a Meta: solo una demo SUPERVISADA cuya conexión usa el número de prueba de
 * Meta (+1 555…) va sin el 9; un negocio real, o una demo con número propio, conserva el formato predeterminado.
 */

const META_TEST_DISPLAY = "+1 555-025-3483";
const PHONE = "11 5555-0101";
const demos: string[] = [];
const shops: Array<{ cleanup: () => Promise<void> }> = [];

beforeEach(() => stubWhatsappEnv());
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.notification.updateMany({ where: { organizationId: { in: demos }, status: "pending" }, data: { status: "canceled" } });
});
afterAll(async () => {
  await db.appointment.deleteMany({ where: { organizationId: { in: demos } } });
  await db.organization.deleteMany({ where: { id: { in: demos } } });
  for (const shop of shops) await shop.cleanup();
});

describe("usesMetaTestNumber", () => {
  const supervised = { isDemo: true, demoKind: "supervised" };
  it("solo una demo supervisada con un número de prueba de Meta", () => {
    expect(usesMetaTestNumber({ displayPhone: META_TEST_DISPLAY }, supervised)).toBe(true);
    expect(usesMetaTestNumber({ displayPhone: "+1 555-025-3483" }, { isDemo: true, demoKind: "public" })).toBe(false);
    expect(usesMetaTestNumber({ displayPhone: META_TEST_DISPLAY }, { isDemo: false, demoKind: null })).toBe(false);
  });
  it("una demo con un número propio o sin validar conserva el predeterminado", () => {
    expect(usesMetaTestNumber({ displayPhone: "+54 9 11 5555-0000" }, supervised)).toBe(false);
    expect(usesMetaTestNumber({ displayPhone: "+1 415 555 0100" }, supervised)).toBe(false);
    expect(usesMetaTestNumber({ displayPhone: null }, supervised)).toBe(false);
    expect(recipientFormatFor({ displayPhone: META_TEST_DISPLAY }, supervised)).toBe("ar-without-9");
    expect(recipientFormatFor({ displayPhone: null }, supervised)).toBeUndefined();
  });
});

async function bookAndSend(organizationId: string, displayPhone: string | null) {
  await connectWhatsapp(organizationId);
  await db.whatsappConnection.update({ where: { organizationId }, data: { displayPhone } });
  const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const service = await db.service.findFirstOrThrow({ where: { organizationId } });
  const result = await createAppointment({
    organization,
    serviceId: service.id,
    startsAt: zonedTimeToUtc(addDays(todayInTz(organization.timezone), 7), 15 * 60, organization.timezone),
    customer: { name: "Visitante", email: null, phone: PHONE },
    actor: "customer",
    whatsappConsent: { source: "public_booking" },
    professional: "any",
  });
  expect(result.ok).toBe(true);
  const meta = fakeMeta();
  vi.stubGlobal("fetch", meta.handler);
  await processDueNotifications(50);
  const sends = meta.messages();
  const notification = await db.notification.findFirstOrThrow({ where: { organizationId, channel: "whatsapp" } });
  return { sends, notification };
}

describe("avisos automáticos", () => {
  it("demo supervisada con el número de prueba de Meta: sin el 9; el registro interno conserva el 549", async () => {
    const demo = await createDemoWorkspace({ kind: "supervised", allowedRecipients: ["5491155550101"] });
    demos.push(demo.organizationId);
    const { sends, notification } = await bookAndSend(demo.organizationId, META_TEST_DISPLAY);
    expect(sends.length).toBeGreaterThanOrEqual(1);
    expect(sends.every((call) => call.body?.to === "541155550101")).toBe(true);
    expect(notification.recipient).toBe("5491155550101");
    expect(await db.whatsappMessage.findMany({ where: { organizationId: demo.organizationId, direction: "outbound" }, select: { phone: true } })).toSatisfy((rows: Array<{ phone: string | null }>) => rows.length > 0 && rows.every((row) => row.phone === "5491155550101"));
  });

  it("demo supervisada con un número propio: formato predeterminado (549)", async () => {
    const demo = await createDemoWorkspace({ kind: "supervised", allowedRecipients: ["5491155550101"] });
    demos.push(demo.organizationId);
    const { sends } = await bookAndSend(demo.organizationId, "+54 9 11 5555-0000");
    expect(sends.length).toBeGreaterThanOrEqual(1);
    expect(sends.every((call) => call.body?.to === "5491155550101")).toBe(true);
  });

  it("un negocio real conserva el formato predeterminado, aunque su número se parezca a uno de prueba", async () => {
    const real = await createSchedulableOrganization();
    shops.push(real);
    const { sends } = await bookAndSend(real.organization.id, META_TEST_DISPLAY);
    expect(sends.length).toBeGreaterThanOrEqual(1);
    expect(sends.every((call) => call.body?.to === "5491155550101")).toBe(true);
  });

  it("las respuestas de sesión siguen la misma regla", async () => {
    const demo = await createDemoWorkspace({ kind: "supervised", allowedRecipients: ["5491155550101"] });
    demos.push(demo.organizationId);
    await connectWhatsapp(demo.organizationId);
    await db.whatsappConnection.update({ where: { organizationId: demo.organizationId }, data: { displayPhone: META_TEST_DISPLAY } });
    const real = await createSchedulableOrganization();
    shops.push(real);
    await connectWhatsapp(real.organization.id);
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await sendSessionReply(demo.organizationId, { to: "5491155550101", text: "hola" });
    await sendSessionReply(real.organization.id, { to: "5491155550101", text: "hola" });
    expect(meta.messages().map((call) => call.body?.to)).toEqual(["541155550101", "5491155550101"]);
  });
});

describe("números entrantes por webhook", () => {
  it("un móvil argentino con o sin 9 se unifica a 549…; el resto no se toca", () => {
    expect(canonicalInboundNumber("5493705204454")).toBe("5493705204454");
    expect(canonicalInboundNumber("543705204454")).toBe("5493705204454");
    expect(canonicalInboundNumber("+54 11 5555-0101")).toBe("5491155550101");
    expect(canonicalInboundNumber("59899123456")).toBe("59899123456");
    expect(canonicalInboundNumber("14155550100")).toBe("14155550100");
  });
});
