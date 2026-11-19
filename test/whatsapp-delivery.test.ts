import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createAppointment, cancelAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { processDueNotifications } from "@/modules/notifications/process";
import { monthlyUsage } from "@/modules/whatsapp/service";
import { revokeConsent, normalizePhone } from "@/modules/whatsapp/consent";
import { TEMPLATES } from "@/modules/whatsapp/templates";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createDemoWorkspace } from "@/modules/demo/workspace";
import { createSchedulableOrganization } from "./helpers";
import { connectWhatsapp, fakeMeta, stubWhatsappEnv } from "./whatsapp-helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];
const demos: string[] = [];
const PHONE = "11 5555-0101";
const PHONE_DIGITS = "5491155550101";

async function shop() {
  const t = await createSchedulableOrganization();
  tenants.push(t);
  return t;
}

let slotCounter = 0;
/** Reserva pública con consentimiento de WhatsApp (o sin él). */
async function book(t: Tenant, options: { consent?: boolean; phone?: string | null; daysAhead?: number } = {}) {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: t.organization.id } });
  const day = addDays(todayInTz(organization.timezone), options.daysAhead ?? 6);
  const startsAt = zonedTimeToUtc(day, 9 * 60 + 30 * (slotCounter++ % 14), organization.timezone);
  const result = await createAppointment({
    organization,
    serviceId: t.service.id,
    startsAt,
    customer: { name: "Ana Pérez", email: null, phone: options.phone === undefined ? PHONE : options.phone },
    actor: "customer",
    whatsappConsent: options.consent === false ? null : { source: "public_booking" },
  });
  if (!result.ok) throw new Error(result.message);
  return { organization, appointment: result.appointment };
}

const waRows = (appointmentId: string) => db.notification.findMany({ where: { appointmentId, channel: "whatsapp" }, orderBy: { scheduledFor: "asc" } });

beforeEach(() => stubWhatsappEnv());
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Lo que un test deja pendiente no debe procesarse en el siguiente (el procesador toma lo vencido de TODOS los negocios).
  await db.notification.updateMany({ where: { organizationId: { in: [...tenants.map((t) => t.organization.id), ...demos] }, status: "pending" }, data: { status: "canceled" } });
});
afterAll(async () => {
  for (const t of tenants) await t.cleanup();
  await db.appointment.deleteMany({ where: { organizationId: { in: demos } } });
  await db.organization.deleteMany({ where: { id: { in: demos } } });
});

describe("qué se encola", () => {
  it("con WhatsApp activo y consentimiento: confirmación ahora y recordatorio a la hora configurada", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { reminderHoursBefore: 12 } });
    const { appointment } = await book(t);
    const rows = await waRows(appointment.id);
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(["booking_confirmation", "reminder"]));
    expect(rows.every((r) => r.recipient === PHONE_DIGITS)).toBe(true);
    const reminder = rows.find((r) => r.type === "reminder")!;
    expect(reminder.scheduledFor.getTime()).toBe(appointment.startsAt.getTime() - 12 * 3600000);
  });

  it("sin consentimiento no se encola nada de WhatsApp (el correo no se toca)", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    const { appointment } = await book(t, { consent: false });
    expect(await waRows(appointment.id)).toHaveLength(0);
  });

  it("sin teléfono válido, con la integración apagada o sin conectar: nada", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    expect(await waRows((await book(t, { phone: null })).appointment.id)).toHaveLength(0);
    expect(await waRows((await book(t, { phone: "123" })).appointment.id)).toHaveLength(0);
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { enabled: false } });
    expect(await waRows((await book(t)).appointment.id)).toHaveLength(0);
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { enabled: true, status: "error" } });
    expect(await waRows((await book(t)).appointment.id)).toHaveLength(0);
  });

  it("cada aviso se puede desactivar en la configuración", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { sendConfirmations: false, sendReminders: false } });
    expect(await waRows((await book(t)).appointment.id)).toHaveLength(0);
  });

  it("reprogramar y cancelar anulan lo pendiente y avisan por WhatsApp", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    const { organization, appointment } = await book(t);
    const day = addDays(todayInTz(organization.timezone), 8);
    const moved = await rescheduleAppointment({ organization, appointmentId: appointment.id, startsAt: zonedTimeToUtc(day, 11 * 60, organization.timezone), actor: "professional" });
    expect(moved.ok).toBe(true);
    let rows = await waRows(appointment.id);
    expect(rows.filter((r) => r.status === "canceled").length).toBeGreaterThanOrEqual(2); // confirmación y recordatorio anteriores
    expect(rows.filter((r) => r.status === "pending").map((r) => r.type)).toEqual(expect.arrayContaining(["reschedule", "reminder"]));
    await cancelAppointment({ organization, appointmentId: appointment.id, actor: "professional" });
    rows = await waRows(appointment.id);
    expect(rows.filter((r) => r.status === "pending").map((r) => r.type)).toEqual(["cancellation"]);
  });

  it("la demo pública nunca encola WhatsApp (se ve en la vista previa); la supervisada sí", async () => {
    const publicDemo = await createDemoWorkspace({ kind: "public" });
    const supervised = await createDemoWorkspace({ kind: "supervised", allowedRecipients: [PHONE_DIGITS] });
    demos.push(publicDemo.organizationId, supervised.organizationId);
    for (const demo of [publicDemo, supervised]) {
      await connectWhatsapp(demo.organizationId);
      const organization = await db.organization.findUniqueOrThrow({ where: { id: demo.organizationId } });
      const service = await db.service.findFirstOrThrow({ where: { organizationId: organization.id } });
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
      const rows = result.ok ? await waRows(result.appointment.id) : [];
      expect(rows.length > 0).toBe(demo === supervised);
    }
  });
});

describe("envío", () => {
  async function setup(extra: Parameters<typeof connectWhatsapp>[1] = {}) {
    const t = await shop();
    const creds = await connectWhatsapp(t.organization.id, extra);
    const booked = await book(t);
    return { t, creds, ...booked };
  }

  it("envía la plantilla aprobada de ESE negocio, con su token y su número, y lo registra en el historial", async () => {
    const { t, creds, appointment } = await setup();
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await processDueNotifications(50);

    const sends = meta.messages();
    expect(sends.length).toBeGreaterThanOrEqual(1);
    const confirmation = sends.find((call) => (call.body?.template as { name: string }).name === TEMPLATES.booking_confirmation.name)!;
    expect(confirmation.token).toBe(creds.token);
    expect(confirmation.path).toBe(`/${creds.phoneNumberId}/messages`);
    expect(confirmation.body).toMatchObject({ messaging_product: "whatsapp", to: PHONE_DIGITS, type: "template" });
    const components = (confirmation.body!.template as { components: Array<{ type: string; parameters: Array<{ text?: string; payload?: string }> }> }).components;
    expect(components[0].parameters.map((p) => p.text)[0]).toBe("Ana");
    expect(components.flatMap((c) => c.parameters).some((p) => p.payload === `c:${appointment.manageToken}`)).toBe(true);

    const history = await db.whatsappMessage.findMany({ where: { organizationId: t.organization.id } });
    expect(history.length).toBe(sends.length);
    expect(history.every((m) => m.status === "sent" && m.providerMessageId && m.direction === "outbound")).toBe(true);
    const notification = (await waRows(appointment.id)).find((r) => r.type === "booking_confirmation")!;
    expect(notification).toMatchObject({ status: "sent" });
  });

  it("no se envía dos veces: reprocesar no llama de nuevo a Meta", async () => {
    const { t } = await setup();
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await processDueNotifications(50);
    const first = meta.messages().length;
    await processDueNotifications(50);
    await processDueNotifications(50);
    expect(meta.messages().length).toBe(first);
    expect(await db.whatsappMessage.count({ where: { organizationId: t.organization.id } })).toBe(first);
  });

  it("si un intento anterior quedó en estado incierto NO se reenvía (para no duplicar el mensaje)", async () => {
    const { t, appointment } = await setup();
    const notification = (await waRows(appointment.id)).find((r) => r.type === "booking_confirmation")!;
    await db.whatsappMessage.create({ data: { organizationId: t.organization.id, notificationId: notification.id, appointmentId: appointment.id, direction: "outbound", kind: "booking_confirmation", phone: PHONE_DIGITS, status: "sending" } });
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await processDueNotifications(50);
    expect(meta.messages().some((call) => (call.body?.template as { name: string }).name === TEMPLATES.booking_confirmation.name)).toBe(false);
    expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject({ status: "failed", lastError: expect.stringContaining("incierto") });
    expect((await db.whatsappMessage.findUniqueOrThrow({ where: { notificationId: notification.id } })).status).toBe("unknown");
  });

  it("con la plantilla sin aprobar, falla con un mensaje claro y no llama a Meta", async () => {
    const { t, appointment } = await setup();
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { templatesStatus: { booking_confirmation: "PENDING", reminder: "APPROVED" } } });
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await processDueNotifications(50);
    expect(meta.messages().some((call) => (call.body?.template as { name: string }).name === TEMPLATES.booking_confirmation.name)).toBe(false);
    expect((await waRows(appointment.id)).find((r) => r.type === "booking_confirmation")).toMatchObject({ status: "failed", lastError: expect.stringContaining("no está aprobada") });
  });

  it("respeta el límite mensual: al alcanzarlo no se envía más y queda registrado", async () => {
    const { t, appointment } = await setup({ monthlyLimit: 1 });
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    // Se programa el recordatorio para ahora para que ambos avisos estén pendientes a la vez.
    await db.notification.updateMany({ where: { appointmentId: appointment.id, channel: "whatsapp", type: "reminder" }, data: { scheduledFor: new Date() } });
    await processDueNotifications(50);
    expect(meta.messages()).toHaveLength(1);
    const rows = await waRows(appointment.id);
    expect(rows.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(rows.find((r) => r.status === "failed")?.lastError).toContain("límite mensual");
    expect(await monthlyUsage(t.organization.id)).toEqual({ used: 1, failed: 0 });
  });

  it("el consumo y el límite son por negocio: el de uno no afecta al otro", async () => {
    const [a, b] = [await shop(), await shop()];
    await connectWhatsapp(a.organization.id, { monthlyLimit: 1 });
    await connectWhatsapp(b.organization.id, { monthlyLimit: 5 });
    await book(a);
    await book(b);
    vi.stubGlobal("fetch", fakeMeta().handler);
    await db.notification.updateMany({ where: { channel: "whatsapp", organizationId: { in: [a.organization.id, b.organization.id] }, type: "reminder" }, data: { scheduledFor: new Date() } });
    await processDueNotifications(50);
    expect((await monthlyUsage(a.organization.id)).used).toBe(1);
    expect((await monthlyUsage(b.organization.id)).used).toBe(2);
  });

  it("un error definitivo de Meta (número sin WhatsApp) no se reintenta; uno transitorio sí, con espera", async () => {
    const { appointment } = await setup();
    vi.stubGlobal("fetch", fakeMeta({ sendError: { status: 400, code: 131026, message: "Message undeliverable" } }).handler);
    await processDueNotifications(50);
    expect((await waRows(appointment.id)).find((r) => r.type === "booking_confirmation")).toMatchObject({ status: "failed", lastError: expect.stringContaining("undeliverable") });

    const second = await setup();
    vi.stubGlobal("fetch", fakeMeta({ sendError: { status: 503, code: 2, message: "Service temporarily unavailable" } }).handler);
    await processDueNotifications(50);
    const retried = (await waRows(second.appointment.id)).find((r) => r.type === "booking_confirmation")!;
    expect(retried.status).toBe("pending");
    expect(retried.attempts).toBe(1);
    expect(retried.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });

  it("un token vencido (error 190) apaga la conexión y no se sigue intentando", async () => {
    const { t } = await setup();
    vi.stubGlobal("fetch", fakeMeta({ sendError: { status: 401, code: 190, message: "Error validating access token" } }).handler);
    await processDueNotifications(50);
    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).toMatchObject({ enabled: false, status: "error" });
  });

  it("si el cliente se dio de baja antes del envío, no se envía; si se apaga la integración, tampoco", async () => {
    const { t, appointment } = await setup();
    await revokeConsent(db, { organizationId: t.organization.id, phone: PHONE_DIGITS });
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await processDueNotifications(50);
    expect(meta.messages()).toHaveLength(0);
    // Lo vencido se omite (el recordatorio todavía no le toca).
    expect((await waRows(appointment.id)).filter((r) => r.scheduledFor <= new Date()).every((r) => r.status === "skipped")).toBe(true);

    const other = await setup();
    await db.whatsappConnection.update({ where: { organizationId: other.t.organization.id }, data: { enabled: false } });
    await processDueNotifications(50);
    expect(meta.messages()).toHaveLength(0);
  });

  it("el número se normaliza al formato internacional", () => {
    expect(normalizePhone("011 15 5555-0101", "America/Argentina/Buenos_Aires")).toBe("5491155550101");
    expect(normalizePhone("+34 600 123 456", "America/Argentina/Buenos_Aires")).toBe("34600123456");
    expect(normalizePhone("abc", "America/Argentina/Buenos_Aires")).toBeNull();
  });
});
