import "server-only";

import { createHmac } from "node:crypto";
import { safeEqualHex } from "./crypto";

/**
 * Cliente mínimo de la WhatsApp Business Cloud API de Meta (la API OFICIAL; no se usa WhatsApp Web ni ninguna
 * automatización no oficial). Solo `fetch`, sin SDK. Cada llamada recibe las credenciales del negocio: no hay token global.
 *
 * Versión de la Graph API: `WHATSAPP_GRAPH_VERSION` (por defecto v25.0, disponible hasta 2028 según la tabla de
 * versiones de Meta consultada el 2026-11-19; la más nueva era la v27.0).
 */
export const graphVersion = () => process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
const base = () => `https://graph.facebook.com/${graphVersion()}`;

export class MetaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    /** Un reintento puede funcionar (límite de uso, caída de Meta); si no, el envío falla definitivamente. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/**
 * Códigos de error de Meta que NO se reintentan: el mensaje no se va a poder entregar por más que se repita
 * (destinatario sin WhatsApp, plantilla inexistente o rechazada, número inválido, credenciales vencidas…).
 */
function classify(status: number, code: string | null): boolean {
  if (status === 429 || status >= 500) return true;
  if (code === "4" || code === "80007" || code === "130429" || code === "131056") return true; // límites de uso
  return false;
}

async function graph<T>(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new MetaError(0, null, `No se pudo conectar con Meta: ${error instanceof Error ? error.message : "error de red"}`, true);
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = (json as { error?: { code?: number | string; message?: string; error_data?: { details?: string } } } | null)?.error;
    const code = error?.code !== undefined ? String(error.code) : null;
    const detail = error?.error_data?.details ? ` (${error.error_data.details})` : "";
    throw new MetaError(response.status, code, `${error?.message ?? `Meta respondió ${response.status}`}${detail}`.slice(0, 400), classify(response.status, code));
  }
  return json as T;
}

export type PhoneNumberInfo = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
};

/** Valida el token y el número: si Meta responde, las credenciales sirven para ese número. */
export const getPhoneNumber = (token: string, phoneNumberId: string) =>
  graph<PhoneNumberInfo>(
    "GET",
    `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status`,
    token,
  );

export type RemoteTemplate = { id: string; name: string; status: string; language: string; category?: string };

export const listTemplates = async (token: string, wabaId: string): Promise<RemoteTemplate[]> => {
  const result = await graph<{ data?: RemoteTemplate[] }>("GET", `/${encodeURIComponent(wabaId)}/message_templates?fields=name,status,language,category&limit=200`, token);
  return result.data ?? [];
};

export const createTemplate = (token: string, wabaId: string, definition: Record<string, unknown>) =>
  graph<{ id: string; status: string; category?: string }>("POST", `/${encodeURIComponent(wabaId)}/message_templates`, token, definition);

export type SendResult = { messageId: string };

async function sendMessage(token: string, phoneNumberId: string, payload: Record<string, unknown>): Promise<SendResult> {
  const result = await graph<{ messages?: Array<{ id: string }> }>("POST", `/${encodeURIComponent(phoneNumberId)}/messages`, token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...payload,
  });
  const id = result.messages?.[0]?.id;
  if (!id) throw new MetaError(200, null, "Meta no devolvió el identificador del mensaje.", false);
  return { messageId: id };
}

export type TemplateComponent = { type: "body" | "button"; sub_type?: "quick_reply" | "url"; index?: string; parameters: Array<{ type: "text"; text: string } | { type: "payload"; payload: string }> };

export const sendTemplate = (token: string, phoneNumberId: string, to: string, name: string, language: string, components: TemplateComponent[]) =>
  sendMessage(token, phoneNumberId, { to, type: "template", template: { name, language: { code: language }, components } });

/** Mensaje de texto libre: solo dentro de las 24 h posteriores a una respuesta del destinatario. */
export const sendText = (token: string, phoneNumberId: string, to: string, text: string) =>
  sendMessage(token, phoneNumberId, { to, type: "text", text: { body: text.slice(0, 1000), preview_url: false } });

/** Mensaje con botones de respuesta (también dentro de las 24 h): se usa para confirmar una cancelación. */
export const sendButtons = (token: string, phoneNumberId: string, to: string, text: string, buttons: Array<{ id: string; title: string }>) =>
  sendMessage(token, phoneNumberId, {
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: text.slice(0, 1000) },
      action: { buttons: buttons.slice(0, 3).map((button) => ({ type: "reply", reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) } })) },
    },
  });

/**
 * Firma del webhook: `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 del cuerpo CRUDO con el secreto de la aplicación
 * de Meta. Comparación en tiempo constante.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqualHex(expected, match[1].toLowerCase());
}
