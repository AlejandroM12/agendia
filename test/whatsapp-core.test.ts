import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { decryptCredentials, decryptSecret, encryptCredentials, encryptSecret, hintOf, isEncryptionConfigured } from "@/modules/whatsapp/crypto";
import { verifyMetaSignature } from "@/modules/whatsapp/meta";
import { revokeCredentials, saveConnection, setEnabled, syncTemplates, validateConnection } from "@/modules/whatsapp/service";
import { TEMPLATES, WHATSAPP_KINDS, cleanVariable, metaTemplateDefinition, templateComponents, templateVariables } from "@/modules/whatsapp/templates";
import { createSchedulableOrganization } from "./helpers";
import { APP_SECRET, KEY, connectWhatsapp, fakeMeta, nextId, signedWebhook, stubWhatsappEnv } from "./whatsapp-helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];
async function tenant() {
  const t = await createSchedulableOrganization();
  tenants.push(t);
  return t;
}

beforeEach(() => stubWhatsappEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  for (const t of tenants) await t.cleanup();
});

describe("cifrado de credenciales", () => {
  it("ida y vuelta, y lo guardado no contiene el secreto en claro", () => {
    const stored = encryptCredentials({ accessToken: "EAAB-secreto-muy-largo", appSecret: "otro-secreto" });
    expect(stored).not.toContain("EAAB");
    expect(stored).not.toContain("otro-secreto");
    expect(decryptCredentials(stored)).toEqual({ accessToken: "EAAB-secreto-muy-largo", appSecret: "otro-secreto" });
  });

  it("cada cifrado es distinto (vector aleatorio) y un texto alterado no se puede leer", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
    const parts = encryptSecret("hola").split(".");
    parts[4] = Buffer.from("alterado").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("sin clave configurada no se puede cifrar, y una clave equivocada no descifra", () => {
    const stored = encryptSecret("dato");
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", "");
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("dato")).toThrow(/WHATSAPP_ENCRYPTION_KEY/);
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => decryptSecret(stored)).toThrow(/ya no está configurada/);
  });

  it("rotación: lo cifrado con la clave anterior se sigue leyendo", () => {
    const stored = encryptSecret("dato");
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY_PREVIOUS", KEY);
    expect(decryptSecret(stored)).toBe("dato");
  });

  it("la pista del token muestra solo los últimos caracteres", () => {
    expect(hintOf("EAAB1234567890abcd")).toBe("…abcd");
    expect(hintOf("corto")).toBe("••••");
  });
});

describe("firma del webhook de Meta", () => {
  const { raw, signature } = signedWebhook(APP_SECRET, { hola: "mundo" });

  it("acepta la firma correcta y rechaza cualquier alteración", () => {
    expect(verifyMetaSignature(raw, signature, APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(raw + " ", signature, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, signature, "otro-secreto")).toBe(false);
    expect(verifyMetaSignature(raw, null, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=zz", APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, signature.replace("sha256=", ""), APP_SECRET)).toBe(false);
  });
});

describe("plantillas", () => {
  it("las variables se limpian: sin saltos de línea ni espacios repetidos y con largo máximo", () => {
    expect(cleanVariable("Ana\nPérez\t  López", 40)).toBe("Ana Pérez López");
    expect(cleanVariable("x".repeat(200), 20)).toHaveLength(20);
    expect(cleanVariable("   ", 10)).toBe("-");
  });

  it("el profesional se suma al servicio solo cuando corresponde", () => {
    const base = { customerFirstName: "Ana", organizationName: "Barbería", serviceName: "Corte", when: "mañana 10:00" };
    expect(templateVariables(base)[2]).toBe("Corte");
    expect(templateVariables({ ...base, professionalName: "Luciano" })[2]).toBe("Corte con Luciano");
  });

  it("cada plantilla se define en Meta como utilidad, en el idioma pedido, con sus variables de ejemplo y sus botones", () => {
    for (const kind of WHATSAPP_KINDS) {
      const definition = metaTemplateDefinition(kind, "https://agendia.atajolab.dev/", "es_AR") as { name: string; category: string; language: string; components: Array<Record<string, unknown>> };
      expect(definition).toMatchObject({ name: TEMPLATES[kind].name, category: "UTILITY", language: "es_AR" });
      const body = definition.components.find((c) => c.type === "BODY") as { text: string; example: { body_text: string[][] } };
      expect(body.text).toContain("{{4}}");
      expect(body.example.body_text[0]).toHaveLength(4);
      const buttons = (definition.components.find((c) => c.type === "BUTTONS") as { buttons: Array<{ type: string; url?: string }> }).buttons;
      for (const button of buttons.filter((b) => b.type === "URL")) expect(button.url).toMatch(/^https:\/\/agendia\.atajolab\.dev\/(turno\/)?\{\{1\}\}$/);
    }
  });

  it("al enviar, las respuestas rápidas llevan el token del turno y los enlaces, su sufijo", () => {
    const components = templateComponents("booking_confirmation", { customerFirstName: "Ana", organizationName: "B", serviceName: "S", when: "w" }, { appointmentToken: "a".repeat(32), organizationSlug: "mi-negocio" });
    const buttons = components.filter((c) => c.type === "button");
    expect(buttons.map((b) => b.sub_type)).toEqual(["quick_reply", "quick_reply", "url"]);
    expect(buttons[0].parameters[0]).toEqual({ type: "payload", payload: `c:${"a".repeat(32)}` });
    expect(buttons[1].parameters[0]).toEqual({ type: "payload", payload: `x:${"a".repeat(32)}` });
    expect(buttons[2].parameters[0]).toEqual({ type: "text", text: "a".repeat(32) });
    expect(components[0].parameters).toHaveLength(4);
  });
});

describe("conexión por negocio", () => {
  it("guarda las credenciales cifradas: nada en claro en la base", async () => {
    const t = await tenant();
    const phoneNumberId = nextId();
    const result = await saveConnection(t.organization.id, { phoneNumberId, wabaId: nextId(), accessToken: "EAAB-token-en-claro-12345", appSecret: "secreto-en-claro-67890" });
    expect(result.ok).toBe(true);
    const row = await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(JSON.stringify(row)).not.toContain("EAAB-token-en-claro");
    expect(JSON.stringify(row)).not.toContain("secreto-en-claro");
    expect(row.credentialsHint).toBe("…2345");
    expect(row).toMatchObject({ enabled: false, status: "not_validated" });
  });

  it("sin credenciales no se puede crear, y con IDs inválidos tampoco", async () => {
    const t = await tenant();
    expect(await saveConnection(t.organization.id, { phoneNumberId: nextId(), wabaId: nextId() })).toMatchObject({ ok: false });
    expect(await saveConnection(t.organization.id, { phoneNumberId: "abc", wabaId: "def", accessToken: "t", appSecret: "s" })).toMatchObject({ ok: false });
  });

  it("un mismo número no puede estar conectado a dos negocios", async () => {
    const [a, b] = [await tenant(), await tenant()];
    const phoneNumberId = nextId();
    expect((await saveConnection(a.organization.id, { phoneNumberId, wabaId: nextId(), accessToken: "t1", appSecret: "s1" })).ok).toBe(true);
    expect(await saveConnection(b.organization.id, { phoneNumberId, wabaId: nextId(), accessToken: "t2", appSecret: "s2" })).toMatchObject({ ok: false, message: expect.stringContaining("otro negocio") });
  });

  it("cambiar credenciales o número desactiva la conexión y exige validar de nuevo; cambiar solo el idioma no", async () => {
    const t = await tenant();
    const { phoneNumberId } = await connectWhatsapp(t.organization.id);
    const wabaId = (await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).wabaId!;
    await saveConnection(t.organization.id, { phoneNumberId, wabaId, templateLanguage: "es" });
    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).toMatchObject({ enabled: true, status: "connected" });
    await saveConnection(t.organization.id, { phoneNumberId, wabaId, accessToken: "token-nuevo-1234" });
    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).toMatchObject({ enabled: false, status: "not_validated", credentialsHint: "…1234" });
  });

  it("validar: con el token de ese negocio llega a Meta y deja la conexión validada con el estado de las plantillas", async () => {
    const t = await tenant();
    const { phoneNumberId, token } = await connectWhatsapp(t.organization.id);
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { status: "not_validated", enabled: false } });
    const meta = fakeMeta({ templates: { booking_confirmation: "APPROVED", reminder: "PENDING" } });
    vi.stubGlobal("fetch", meta.handler);
    const result = await validateConnection(t.organization.id);
    expect(result).toMatchObject({ ok: true, displayPhone: "+54 9 11 5555-0000" });
    expect(meta.calls.every((call) => call.token === token)).toBe(true);
    expect(meta.calls[0].path).toBe(`/${phoneNumberId}`);
    const row = await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(row).toMatchObject({ status: "connected", verifiedName: "Negocio Test" });
    expect(row.templatesStatus).toMatchObject({ booking_confirmation: "APPROVED", reminder: "PENDING", cancellation: "MISSING" });
  });

  it("validar con un token vencido deja la conexión en error y desactivada, sin exponer el token", async () => {
    const t = await tenant();
    await connectWhatsapp(t.organization.id, { token: "token-que-no-se-debe-filtrar" });
    vi.stubGlobal("fetch", fakeMeta({ failValidation: true }).handler);
    const result = await validateConnection(t.organization.id);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Invalid OAuth") });
    expect(JSON.stringify(result)).not.toContain("token-que-no-se-debe-filtrar");
    expect(await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).toMatchObject({ status: "error", enabled: false });
  });

  it("sincronizar crea en Meta solo las plantillas que faltan", async () => {
    const t = await tenant();
    await connectWhatsapp(t.organization.id);
    const meta = fakeMeta({ templates: { booking_confirmation: "APPROVED" } });
    vi.stubGlobal("fetch", meta.handler);
    const result = await syncTemplates(t.organization.id);
    expect(result).toMatchObject({ ok: true });
    const created = meta.calls.filter((call) => call.method === "POST" && call.path.endsWith("/message_templates")).map((call) => call.body?.name);
    expect(created).toEqual(expect.arrayContaining([TEMPLATES.reminder.name, TEMPLATES.cancellation.name, TEMPLATES.reschedule.name]));
    expect(created).not.toContain(TEMPLATES.booking_confirmation.name);
  });

  it("activar exige una conexión validada; desactivar siempre se puede; revocar borra las credenciales", async () => {
    const t = await tenant();
    await saveConnection(t.organization.id, { phoneNumberId: nextId(), wabaId: nextId(), accessToken: "t", appSecret: "s" });
    expect(await setEnabled(t.organization.id, true)).toMatchObject({ ok: false });
    await db.whatsappConnection.update({ where: { organizationId: t.organization.id }, data: { status: "connected" } });
    expect(await setEnabled(t.organization.id, true)).toEqual({ ok: true });
    await revokeCredentials(t.organization.id);
    const row = await db.whatsappConnection.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(row).toMatchObject({ credentials: null, credentialsHint: null, enabled: false, status: "not_validated" });
  });
});
