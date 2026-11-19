import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST, GET } from "@/app/api/webhooks/whatsapp/route";
import { createAppointment } from "@/modules/appointments/service";
import { processDueNotifications } from "@/modules/notifications/process";
import { hasActiveConsent } from "@/modules/whatsapp/consent";
import { issueVerifyToken } from "@/modules/whatsapp/service";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization } from "./helpers";
import { APP_SECRET, connectWhatsapp, fakeMeta, metaPayload, signedWebhook, stubWhatsappEnv } from "./whatsapp-helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];
const PHONE = "5491155550101";

async function shop() {
  const t = await createSchedulableOrganization();
  tenants.push(t);
  return t;
}

let slot = 0;
async function bookFor(t: Tenant, phone = "11 5555-0101") {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: t.organization.id } });
  const startsAt = zonedTimeToUtc(addDays(todayInTz(organization.timezone), 10), 9 * 60 + 30 * (slot++ % 14), organization.timezone);
  const result = await createAppointment({
    organization,
    serviceId: t.service.id,
    startsAt,
    customer: { name: "Ana Pérez", email: null, phone },
    actor: "customer",
    whatsappConsent: { source: "public_booking" },
  });
  if (!result.ok) throw new Error(result.message);
  return result.appointment;
}

async function post(secret: string, payload: unknown, options: { signature?: string | null } = {}) {
  const { raw, signature } = signedWebhook(secret, payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = options.signature === undefined ? signature : options.signature;
  if (sig) headers["x-hub-signature-256"] = sig;
  return POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers, body: raw }));
}

const reply = (id: string, from: string, content: Record<string, unknown>) => ({ id, from, timestamp: String(Math.floor(Date.now() / 1000)), ...content });
const buttonReply = (id: string, from: string, payload: string) => reply(id, from, { type: "button", button: { payload, text: "x" } });
let messageCounter = 0;
const wamid = () => `wamid.in.${Date.now()}.${++messageCounter}`;

beforeEach(() => {
  stubWhatsappEnv();
  vi.stubGlobal("fetch", fakeMeta().handler);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

describe("verificación inicial (GET)", () => {
  it("responde el desafío solo con el token que se cargó para algún negocio", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    const token = await issueVerifyToken(t.organization.id);
    const url = (value: string) => `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${value}&hub.challenge=12345`;
    const ok = await GET(new Request(url(token)));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    expect((await GET(new Request(url("otro-token")))).status).toBe(403);
    expect((await GET(new Request("http://localhost/api/webhooks/whatsapp"))).status).toBe(403);
  });

  it("el token se guarda solo como hash", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    const token = await issueVerifyToken(t.organization.id);
    const row = await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.verifyTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("autenticación del webhook (POST)", () => {
  it("sin firma, con firma ajena o con el cuerpo alterado: 401 y no se procesa nada", async () => {
    const t = await shop();
    const { phoneNumberId } = await connectWhatsapp(t.organization.id);
    const appointment = await bookFor(t);
    const payload = metaPayload(phoneNumberId, { messages: [buttonReply(wamid(), PHONE, `c:${appointment.manageToken}`)] });

    expect((await post(APP_SECRET, payload, { signature: null })).status).toBe(401);
    expect((await post("secreto-de-otra-aplicacion", payload)).status).toBe(401);
    const { raw, signature } = signedWebhook(APP_SECRET, payload);
    const tampered = await POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signature }, body: raw.replace("c:", "x:") }));
    expect(tampered.status).toBe(401);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).attendanceConfirmedAt).toBeNull();
    expect(await db.whatsappMessage.count({ where: { organizationId: t.organization.id, direction: "inbound" } })).toBe(0);
  });

  it("un número que no es de ningún negocio, un JSON roto o un objeto desconocido no rompen nada", async () => {
    expect((await post(APP_SECRET, metaPayload("999999999999", { statuses: [] }))).status).toBe(200);
    expect((await POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: "no es json" }))).status).toBe(400);
    expect((await post(APP_SECRET, { object: "page", entry: [] })).status).toBe(200);
  });
});

describe("estados de entrega", () => {
  async function sentMessage(t: Tenant) {
    const creds = await connectWhatsapp(t.organization.id);
    await bookFor(t);
    vi.stubGlobal("fetch", fakeMeta().handler);
    await processDueNotifications(50);
    const message = await db.whatsappMessage.findFirstOrThrow({ where: { organizationId: t.organization.id, direction: "outbound", providerMessageId: { not: null } } });
    return { ...creds, message };
  }

  it("avanzan en orden (enviado → entregado → leído) y un estado viejo o repetido no retrocede", async () => {
    const t = await shop();
    const { phoneNumberId, message } = await sentMessage(t);
    const status = (value: string) => post(APP_SECRET, metaPayload(phoneNumberId, { statuses: [{ id: message.providerMessageId, status: value }] }));
    const current = async () => (await db.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } })).status;

    expect((await status("delivered")).status).toBe(200);
    expect(await current()).toBe("delivered");
    await status("read");
    expect(await current()).toBe("read");
    await status("delivered"); // llega tarde y desordenado
    await status("sent");
    expect(await current()).toBe("read");
  });

  it("un fallo de entrega queda registrado con su error, pero no pisa una entrega ya confirmada", async () => {
    const t = await shop();
    const { phoneNumberId, message } = await sentMessage(t);
    await post(APP_SECRET, metaPayload(phoneNumberId, { statuses: [{ id: message.providerMessageId, status: "failed", errors: [{ code: 131026, message: "Message undeliverable" }] }] }));
    expect(await db.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ status: "failed", errorCode: "131026", errorMessage: "Message undeliverable" });

    const other = await shop();
    const second = await sentMessage(other);
    await post(APP_SECRET, metaPayload(second.phoneNumberId, { statuses: [{ id: second.message.providerMessageId, status: "delivered" }] }));
    await post(APP_SECRET, metaPayload(second.phoneNumberId, { statuses: [{ id: second.message.providerMessageId, status: "failed", errors: [{ code: 1, message: "x" }] }] }));
    expect((await db.whatsappMessage.findUniqueOrThrow({ where: { id: second.message.id } })).status).toBe("delivered");
  });

  it("el estado de un mensaje de OTRO negocio no se puede tocar", async () => {
    const [a, b] = [await shop(), await shop()];
    const first = await sentMessage(a);
    const second = await sentMessage(b);
    // El negocio B (con su firma) informa un estado sobre el mensaje de A: se ignora.
    await post(APP_SECRET, metaPayload(second.phoneNumberId, { statuses: [{ id: first.message.providerMessageId, status: "read" }] }));
    expect((await db.whatsappMessage.findUniqueOrThrow({ where: { id: first.message.id } })).status).toBe("sent");
  });
});

describe("respuestas de los clientes", () => {
  it("«Confirmo» deja registrada la asistencia, contesta y no se procesa dos veces", async () => {
    const t = await shop();
    const { phoneNumberId } = await connectWhatsapp(t.organization.id);
    const appointment = await bookFor(t);
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    const message = buttonReply(wamid(), PHONE, `c:${appointment.manageToken}`);

    expect((await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [message] }))).status).toBe(200);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).attendanceConfirmedAt).not.toBeNull();
    expect(meta.messages()).toHaveLength(1);
    expect((meta.messages()[0].body as { text: { body: string } }).text.body).toContain("confirmada tu asistencia");

    await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [message] })); // Meta reenvía el mismo aviso
    expect(meta.messages()).toHaveLength(1);
    expect(await db.whatsappMessage.count({ where: { organizationId: t.organization.id, direction: "inbound", providerMessageId: message.id } })).toBe(1);
  });

  it("cancelar pide una segunda confirmación; recién ahí se cancela, y «No, mantenerlo» no toca nada", async () => {
    const t = await shop();
    const { phoneNumberId } = await connectWhatsapp(t.organization.id);
    const appointment = await bookFor(t);
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);

    await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [buttonReply(wamid(), PHONE, `x:${appointment.manageToken}`)] }));
    const ask = meta.messages().at(-1)!.body as { type: string; interactive: { action: { buttons: Array<{ reply: { id: string } }> } } };
    expect(ask.type).toBe("interactive");
    expect(ask.interactive.action.buttons.map((b) => b.reply.id)).toEqual([`cx:${appointment.manageToken}`, `ck:${appointment.manageToken}`]);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("confirmed");

    await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [reply(wamid(), PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `ck:${appointment.manageToken}`, title: "No" } } })] }));
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("confirmed");

    await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [reply(wamid(), PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `cx:${appointment.manageToken}`, title: "Sí" } } })] }));
    expect(await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ status: "canceled", canceledBy: "customer" });
  });

  it("respeta el límite para cancelar online: si ya es tarde, no cancela y lo dice", async () => {
    const t = await shop();
    const { phoneNumberId } = await connectWhatsapp(t.organization.id);
    const appointment = await bookFor(t);
    await db.organization.update({ where: { id: t.organization.id }, data: { cancellationNoticeHours: 168 } }); // 7 días: el turno es en 10, pero se sube más
    await db.organization.update({ where: { id: t.organization.id }, data: { cancellationNoticeHours: 168, phone: "11 4444 0000" } });
    await db.appointment.update({ where: { id: appointment.id }, data: { startsAt: new Date(Date.now() + 3 * 3600000), endsAt: new Date(Date.now() + 4 * 3600000) } });
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [reply(wamid(), PHONE, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: `cx:${appointment.manageToken}`, title: "Sí" } } })] }));
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("confirmed");
    expect((meta.messages().at(-1)!.body as { text: { body: string } }).text.body).toContain("Comunicate");
  });

  it("BAJA revoca el consentimiento, anula los avisos pendientes y lo confirma", async () => {
    const t = await shop();
    const { phoneNumberId } = await connectWhatsapp(t.organization.id);
    const appointment = await bookFor(t);
    expect(await hasActiveConsent(db, t.organization.id, PHONE)).toBe(true);
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);

    await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [reply(wamid(), PHONE, { type: "text", text: { body: "  baja " } })] }));
    expect(await hasActiveConsent(db, t.organization.id, PHONE)).toBe(false);
    expect((await db.whatsappConsent.findFirstOrThrow({ where: { organizationId: t.organization.id, phone: PHONE } })).status).toBe("revoked");
    expect(await db.notification.count({ where: { appointmentId: appointment.id, channel: "whatsapp", status: "pending" } })).toBe(0);
    expect((meta.messages().at(-1)!.body as { text: { body: string } }).text.body).toContain("no vas a recibir más avisos");
  });

  describe("aislamiento entre negocios y contra suplantación", () => {
    it("un negocio no puede actuar sobre el turno de otro, aunque conozca su código", async () => {
      const [a, b] = [await shop(), await shop()];
      await connectWhatsapp(a.organization.id);
      const connectionB = await connectWhatsapp(b.organization.id);
      const appointmentA = await bookFor(a);
      const meta = fakeMeta();
      vi.stubGlobal("fetch", meta.handler);

      // Desde la conexión de B llega una respuesta con el código del turno de A (firmada correctamente por B).
      await post(APP_SECRET, metaPayload(connectionB.phoneNumberId, { messages: [buttonReply(wamid(), PHONE, `c:${appointmentA.manageToken}`), buttonReply(wamid(), PHONE, `x:${appointmentA.manageToken}`)] }));
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentA.id } })).attendanceConfirmedAt).toBeNull();
      expect(meta.messages()).toHaveLength(0);
    });

    it("cada negocio firma con SU secreto: el secreto de otro no sirve", async () => {
      const [a, b] = [await shop(), await shop()];
      const connectionA = await connectWhatsapp(a.organization.id, { secret: "secreto-de-a" });
      await connectWhatsapp(b.organization.id, { secret: "secreto-de-b" });
      const payload = metaPayload(connectionA.phoneNumberId, { messages: [reply(wamid(), PHONE, { type: "text", text: { body: "hola" } })] });
      expect((await post("secreto-de-b", payload)).status).toBe(401);
      expect((await post("secreto-de-a", payload)).status).toBe(200);
    });

    it("quien responde tiene que ser el cliente del turno: otro número es ignorado", async () => {
      const t = await shop();
      const { phoneNumberId } = await connectWhatsapp(t.organization.id);
      const appointment = await bookFor(t);
      const meta = fakeMeta();
      vi.stubGlobal("fetch", meta.handler);
      await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [buttonReply(wamid(), "5491100001111", `c:${appointment.manageToken}`), buttonReply(wamid(), "5491100001111", `cx:${appointment.manageToken}`)] }));
      const after = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(after.attendanceConfirmedAt).toBeNull();
      expect(after.status).toBe("confirmed");
      expect(meta.messages()).toHaveLength(0);
    });

    it("códigos mal formados o inexistentes no hacen nada", async () => {
      const t = await shop();
      const { phoneNumberId } = await connectWhatsapp(t.organization.id);
      const meta = fakeMeta();
      vi.stubGlobal("fetch", meta.handler);
      await post(APP_SECRET, metaPayload(phoneNumberId, { messages: [buttonReply(wamid(), PHONE, "c:no-es-un-codigo"), buttonReply(wamid(), PHONE, `c:${"0".repeat(32)}`), buttonReply(wamid(), PHONE, "drop table")] }));
      expect(meta.messages()).toHaveLength(0);
    });
  });
});
