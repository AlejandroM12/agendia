import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { createSchedulableOrganization, fakeContext } from "./helpers";
import { connectWhatsapp, fakeMeta, nextId, stubWhatsappEnv } from "./whatsapp-helpers";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 250) + 1}` }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import {
  issueWhatsappVerifyTokenAction,
  revokeWhatsappCredentialsAction,
  saveWhatsappConnectionAction,
  sendWhatsappTestAction,
  setWhatsappEnabledAction,
  syncWhatsappTemplatesAction,
  updateWhatsappLimitsAction,
  validateWhatsappAction,
} from "@/modules/admin/whatsapp-actions";
import { requestWhatsappActivationAction, updateMyWhatsappSettingsAction } from "@/modules/whatsapp/business-actions";
import { getWhatsappView } from "@/modules/whatsapp/views";
import { createDemoWorkspace } from "@/modules/demo/workspace";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];
const demos: string[] = [];
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

async function shop() {
  const t = await createSchedulableOrganization();
  tenants.push(t);
  return t;
}
/** Sesión de la plataforma (un usuario administrador, que no es de este negocio). */
async function actAsAdmin() {
  const host = await shop();
  const organization = await db.organization.findUniqueOrThrow({ where: { id: host.organization.id } });
  session.current = fakeContext({ userId: host.userId, email: host.ownerEmail, organization, role: "owner", isPlatformAdmin: true });
}
async function actAsOwner(t: Tenant, role: AppContext["role"] = "owner") {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: t.organization.id } });
  session.current = fakeContext({ userId: t.userId, email: t.ownerEmail, organization, role });
}

beforeEach(() => stubWhatsappEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  for (const t of tenants) {
    await db.auditLog.deleteMany({ where: { organizationId: t.organization.id } });
    await t.cleanup();
  }
  await db.organization.deleteMany({ where: { id: { in: demos } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@demo.agendia.invalid" }, memberships: { none: {} } } });
});

describe("administración de WhatsApp: solo la plataforma", () => {
  it("un propietario, un administrador del negocio o un profesional no pueden usar ninguna acción de /admin", async () => {
    const t = await shop();
    for (const role of ["owner", "admin", "professional"] as const) {
      await actAsOwner(t, role);
      const calls = [
        () => saveWhatsappConnectionAction(t.organization.id, undefined, form({ phoneNumberId: nextId(), wabaId: nextId(), accessToken: "t", appSecret: "s" })),
        () => issueWhatsappVerifyTokenAction(t.organization.id, undefined),
        () => validateWhatsappAction(t.organization.id, undefined),
        () => syncWhatsappTemplatesAction(t.organization.id, undefined),
        () => setWhatsappEnabledAction(t.organization.id, true),
        () => updateWhatsappLimitsAction(t.organization.id, undefined, form({ monthlyLimit: "999999" })),
        () => sendWhatsappTestAction(t.organization.id, undefined, form({ to: "11 5555 0000" })),
        () => revokeWhatsappCredentialsAction(t.organization.id),
      ];
      for (const call of calls) expect(await run(call)).toBe("NOT_FOUND");
    }
    expect(await db.whatsappConnection.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });
});

describe("administración de WhatsApp: circuito completo con la plataforma", () => {
  it("alta, validación, plantillas, activación y envío de prueba, todo auditado y sin exponer secretos", async () => {
    const target = await shop();
    await actAsAdmin();
    const admin = (session.current as AppContext).user.id;
    const meta = fakeMeta({ templates: { booking_confirmation: "APPROVED", reminder: "APPROVED", cancellation: "APPROVED", reschedule: "APPROVED" } });
    vi.stubGlobal("fetch", meta.handler);
    const secrets = ["EAAB-token-ultra-secreto-9876", "app-secret-ultra-secreto-5432"];
    const everyResult: unknown[] = [];

    everyResult.push(await saveWhatsappConnectionAction(target.organization.id, undefined, form({ phoneNumberId: nextId(), wabaId: nextId(), accessToken: secrets[0], appSecret: secrets[1] })));
    const verify = (await issueWhatsappVerifyTokenAction(target.organization.id, undefined)) as { ok?: boolean; message?: string };
    expect(verify.message).toMatch(/UNA sola vez/);
    everyResult.push(await validateWhatsappAction(target.organization.id, undefined));
    everyResult.push(await syncWhatsappTemplatesAction(target.organization.id, undefined));
    expect(await updateWhatsappLimitsAction(target.organization.id, undefined, form({ monthlyLimit: "50", reminderHoursBefore: "12", testRecipients: "011 15 5555-0000", sendConfirmations: "on", sendReminders: "on" }))).toMatchObject({ ok: true });
    expect(await setWhatsappEnabledAction(target.organization.id, true)).toMatchObject({ ok: true });
    everyResult.push(await sendWhatsappTestAction(target.organization.id, undefined, form({ to: "011 15 5555-0000", template: "hello_world" })));

    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: target.organization.id } })).toMatchObject({
      enabled: true,
      status: "connected",
      monthlyLimit: 50,
      reminderHoursBefore: 12,
      sendCancellations: false,
      testRecipients: ["5491155550000"],
    });
    // El mensaje de prueba salió con el token de ESTE negocio, a un destinatario autorizado, y quedó marcado como prueba.
    const sent = meta.messages().at(-1)!;
    expect(sent.token).toBe(secrets[0]);
    expect(sent.body).toMatchObject({ to: "541155550000", template: { name: "hello_world" } });
    expect(await db.whatsappMessage.findFirstOrThrow({ where: { organizationId: target.organization.id, kind: "test" } })).toMatchObject({ isTest: true, status: "sent" });

    // Ninguna respuesta ni registro de auditoría contiene los secretos.
    const audit = await db.auditLog.findMany({ where: { organizationId: target.organization.id } });
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["whatsapp.connection.saved", "whatsapp.verify_token.issued", "whatsapp.connection.validated", "whatsapp.templates.synced", "whatsapp.limits.updated", "whatsapp.enabled", "whatsapp.test.sent"]));
    expect(audit.every((row) => row.userId === admin)).toBe(true);
    for (const secret of secrets) {
      expect(JSON.stringify(audit)).not.toContain(secret);
      expect(JSON.stringify(everyResult)).not.toContain(secret);
      expect(JSON.stringify(await getWhatsappView(target.organization.id))).not.toContain(secret);
    }
    const view = await getWhatsappView(target.organization.id);
    expect(view).not.toHaveProperty("credentials");
    expect(view.credentialsHint).toBe("…9876");
  });

  it("el envío de prueba solo sale a números autorizados", async () => {
    const target = await shop();
    await connectWhatsapp(target.organization.id);
    await actAsAdmin();
    const meta = fakeMeta();
    vi.stubGlobal("fetch", meta.handler);
    expect(await sendWhatsappTestAction(target.organization.id, undefined, form({ to: "11 6666 7777", template: "hello_world" }))).toMatchObject({ message: expect.stringContaining("no está en la lista") });
    expect(await sendWhatsappTestAction(target.organization.id, undefined, form({ to: "no es un número" }))).toMatchObject({ message: expect.stringContaining("número válido") });
    expect(meta.messages()).toHaveLength(0);
  });

  it("sin clave de cifrado en el servidor no se guardan credenciales y se explica por qué", async () => {
    const target = await shop();
    await actAsAdmin();
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", "");
    expect(await saveWhatsappConnectionAction(target.organization.id, undefined, form({ phoneNumberId: nextId(), wabaId: nextId(), accessToken: "t", appSecret: "s" }))).toMatchObject({ message: expect.stringContaining("WHATSAPP_ENCRYPTION_KEY") });
    expect(await db.whatsappConnection.count({ where: { organizationId: target.organization.id } })).toBe(0);
  });

  it("no se puede activar sin validar, y revocar borra las credenciales y apaga todo", async () => {
    const target = await shop();
    await actAsAdmin();
    await saveWhatsappConnectionAction(target.organization.id, undefined, form({ phoneNumberId: nextId(), wabaId: nextId(), accessToken: "token-xyz-1234", appSecret: "secret-xyz" }));
    expect(await setWhatsappEnabledAction(target.organization.id, true)).toMatchObject({ message: expect.stringContaining("Validá") });
    await db.whatsappConnection.update({ where: { organizationId: target.organization.id }, data: { status: "connected", enabled: true } });
    expect(await revokeWhatsappCredentialsAction(target.organization.id)).toMatchObject({ ok: true });
    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: target.organization.id } })).toMatchObject({ credentials: null, enabled: false });
  });
});

describe("panel del negocio", () => {
  it("el negocio puede pedir la activación (queda auditada), pero no conectar, activar ni cambiar el límite", async () => {
    const t = await shop();
    await actAsOwner(t);
    expect(await requestWhatsappActivationAction(undefined)).toMatchObject({ ok: true });
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "whatsapp.activation_requested" } })).toBe(1);
    expect(await db.whatsappConnection.count({ where: { organizationId: t.organization.id } })).toBe(0);
    // Las acciones de /admin no existen para él (ver el primer bloque); y su propia acción no toca el límite.
    await connectWhatsapp(t.organization.id, { monthlyLimit: 40 });
    await actAsOwner(t);
    await updateMyWhatsappSettingsAction(undefined, form({ monthlyLimit: "999999", sendConfirmations: "on", reminderHoursBefore: "6" }));
    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).toMatchObject({ monthlyLimit: 40, reminderHoursBefore: 6, sendReminders: false });
  });

  it("solo quien tiene permiso de configuración puede pedir o cambiar (un profesional no)", async () => {
    const t = await shop();
    await connectWhatsapp(t.organization.id);
    await actAsOwner(t, "professional");
    expect(await requestWhatsappActivationAction(undefined)).toMatchObject({ message: expect.any(String) });
    expect(await updateMyWhatsappSettingsAction(undefined, form({ sendConfirmations: "on" }))).toMatchObject({ message: expect.any(String) });
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: { startsWith: "whatsapp." } } })).toBe(0);
  });

  it("no se puede cambiar la configuración de un negocio que no tiene conexión", async () => {
    const t = await shop();
    await actAsOwner(t);
    expect(await updateMyWhatsappSettingsAction(undefined, form({ sendConfirmations: "on" }))).toMatchObject({ message: expect.stringContaining("Todavía no") });
  });

  it("en una demo no se puede pedir la activación", async () => {
    const demo = await createDemoWorkspace({ kind: "public" });
    demos.push(demo.organizationId);
    const organization = await db.organization.findUniqueOrThrow({ where: { id: demo.organizationId } });
    const user = await db.user.findUniqueOrThrow({ where: { email: demo.email } });
    session.current = fakeContext({ userId: user.id, email: user.email, organization, role: "owner" });
    expect(await requestWhatsappActivationAction(undefined)).toMatchObject({ message: expect.stringContaining("demostración") });
  });

  it("cada negocio ve solo lo suyo: consumo, historial y consentimientos", async () => {
    const [a, b] = [await shop(), await shop()];
    await connectWhatsapp(a.organization.id);
    await connectWhatsapp(b.organization.id);
    await db.whatsappMessage.create({ data: { organizationId: a.organization.id, direction: "outbound", kind: "reminder", phone: "5491155550001", status: "sent", providerMessageId: `wamid.a.${nextId()}` } });
    await db.whatsappConsent.create({ data: { organizationId: a.organization.id, phone: "5491155550001", source: "public_booking", textVersion: "v1" } });
    expect((await getWhatsappView(a.organization.id)).messages).toHaveLength(1);
    expect(await getWhatsappView(b.organization.id)).toMatchObject({ messages: [], usage: { used: 0, failed: 0 }, consents: { granted: 0, revoked: 0 } });
  });
});
