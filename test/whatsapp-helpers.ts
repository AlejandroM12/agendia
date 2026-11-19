import { createHmac } from "node:crypto";
import { vi } from "vitest";
import { db } from "@/lib/db";
import { saveConnection } from "@/modules/whatsapp/service";
import { TEMPLATES, WHATSAPP_KINDS } from "@/modules/whatsapp/templates";

export const KEY = Buffer.alloc(32, 7).toString("base64");

export function stubWhatsappEnv() {
  vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", KEY);
}

let counter = 0;
/** Identificadores únicos y deterministas (un número de WhatsApp no puede repetirse entre negocios). */
export const nextId = () => `${Date.now()}${String(++counter).padStart(4, "0")}`;

export type MetaCall = { method: string; path: string; token: string | null; body: Record<string, unknown> | null };

/** Meta simulada: valida token y número, lista y crea plantillas, y «envía» mensajes. Registra cada llamada. */
export function fakeMeta(options: { templates?: Record<string, string>; sendError?: { status: number; code: number; message: string }; failValidation?: boolean } = {}) {
  const calls: MetaCall[] = [];
  let sent = 0;
  const created = new Set<string>();
  const handler = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const token = headers.Authorization?.replace("Bearer ", "") ?? null;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    calls.push({ method, path, token, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (!url.hostname.includes("graph.facebook.com")) return json({});
    if (options.failValidation && method === "GET") return json({ error: { code: 190, message: "Invalid OAuth access token." } }, 401);
    if (method === "POST" && path.endsWith("/messages")) {
      if (options.sendError) return json({ error: { code: options.sendError.code, message: options.sendError.message } }, options.sendError.status);
      return json({ messages: [{ id: `wamid.${++sent}.${Date.now()}` }] });
    }
    if (method === "POST" && path.endsWith("/message_templates")) {
      created.add(String(body?.name));
      return json({ id: `tpl-${created.size}`, status: "PENDING" });
    }
    if (method === "GET" && path.endsWith("/message_templates")) {
      const data = WHATSAPP_KINDS.filter((kind) => options.templates?.[kind] || created.has(TEMPLATES[kind].name)).map((kind) => ({
        id: `t-${kind}`,
        name: TEMPLATES[kind].name,
        status: options.templates?.[kind] ?? "PENDING",
        language: "es_AR",
      }));
      return json({ data });
    }
    if (method === "GET") return json({ id: path.slice(1), display_phone_number: "+54 9 11 5555-0000", verified_name: "Negocio Test", quality_rating: "GREEN" });
    return json({}, 404);
  });
  return { handler, calls, messages: () => calls.filter((call) => call.method === "POST" && call.path.endsWith("/messages")) };
}

export const APP_SECRET = "app-secret-de-prueba";

/** Deja a un negocio con WhatsApp conectado y activo (credenciales cifradas reales, plantillas aprobadas). */
export async function connectWhatsapp(organizationId: string, extra: { token?: string; secret?: string; phoneNumberId?: string; monthlyLimit?: number } = {}) {
  const phoneNumberId = extra.phoneNumberId ?? nextId();
  const saved = await saveConnection(organizationId, {
    phoneNumberId,
    wabaId: nextId(),
    accessToken: extra.token ?? `token-${phoneNumberId}`,
    appSecret: extra.secret ?? APP_SECRET,
  });
  if (!saved.ok) throw new Error(saved.message);
  const approved = Object.fromEntries(WHATSAPP_KINDS.map((kind) => [kind, "APPROVED"]));
  await db.whatsappConnection.update({
    where: { organizationId },
    data: { status: "connected", enabled: true, templatesStatus: approved, monthlyLimit: extra.monthlyLimit ?? 300, testRecipients: ["5491155550000"] },
  });
  return { phoneNumberId, token: extra.token ?? `token-${phoneNumberId}`, secret: extra.secret ?? APP_SECRET };
}

export function signedWebhook(secret: string, payload: unknown) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
  return { raw, signature };
}

export function metaPayload(phoneNumberId: string, value: { statuses?: unknown[]; messages?: unknown[] }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5491100000000", phone_number_id: phoneNumberId }, ...value } }] }],
  };
}
