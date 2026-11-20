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
    readonly subcode: string | null = null,
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

/** El motivo que da Meta (título y mensaje para el usuario, o el genérico) más los códigos y la traza para consultarla. Nunca incluye credenciales. */
function describeMetaError(
  status: number,
  error: { code?: number | string; error_subcode?: number | string; message?: string; error_user_title?: string; error_user_msg?: string; error_data?: { details?: string }; fbtrace_id?: string } | undefined,
): string {
  const reason = [error?.error_user_title, error?.error_user_msg].filter(Boolean).join(": ") || error?.message || `Meta respondió ${status}`;
  const detail = error?.error_data?.details ? ` (${error.error_data.details})` : "";
  const ids = [error?.code !== undefined ? `código ${error.code}` : null, error?.error_subcode !== undefined ? `subcódigo ${error.error_subcode}` : null, error?.fbtrace_id ? `traza ${error.fbtrace_id}` : null].filter(Boolean);
  return `${reason}${detail}${ids.length ? ` [${ids.join(", ")}]` : ""}`.slice(0, 600);
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
    const error = (
      json as {
        error?: { code?: number | string; error_subcode?: number | string; message?: string; error_user_title?: string; error_user_msg?: string; error_data?: { details?: string }; fbtrace_id?: string };
      } | null
    )?.error;
    const code = error?.code !== undefined ? String(error.code) : null;
    throw new MetaError(response.status, code, describeMetaError(response.status, error), classify(response.status, code), error?.error_subcode !== undefined ? String(error.error_subcode) : null);
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

/**
 * Formato del destinatario que se le entrega a Meta. Internamente los números argentinos son `549…` (móvil, como pide
 * wa.me); la lista de destinatarios del número de PRUEBA de Meta, en cambio, guarda `54…` sin el 9 y rechaza `549…`
 * con el error 131030 (confirmado con envíos reales: 543705204454 sale bien y 5493705204454 no, mismo token y número).
 * - `e164`: tal cual (por defecto; es lo que usan los números reales de producción).
 * - `ar-without-9`: solo los móviles argentinos `549` + 10 dígitos pasan a `54` + 10 dígitos; el resto no se toca.
 */
export type RecipientFormat = "e164" | "ar-without-9";

/** `WHATSAPP_AR_RECIPIENT_FORMAT=ar-without-9` para las líneas que lo necesiten; cualquier otro valor deja el número como está. */
export const recipientFormat = (): RecipientFormat => (process.env.WHATSAPP_AR_RECIPIENT_FORMAT === "ar-without-9" ? "ar-without-9" : "e164");

export function toCloudRecipient(to: string, format: RecipientFormat): string {
  if (format !== "ar-without-9") return to;
  const match = /^549(\d{10})$/.exec(to);
  return match ? `54${match[1]}` : to;
}

async function sendMessage(token: string, phoneNumberId: string, payload: Record<string, unknown>, format: RecipientFormat = recipientFormat()): Promise<SendResult> {
  const result = await graph<{ messages?: Array<{ id: string }> }>("POST", `/${encodeURIComponent(phoneNumberId)}/messages`, token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...payload,
    to: toCloudRecipient(String(payload.to), format),
  });
  const id = result.messages?.[0]?.id;
  if (!id) throw new MetaError(200, null, "Meta no devolvió el identificador del mensaje.", false);
  return { messageId: id };
}

export type TemplateComponent = { type: "body" | "button"; sub_type?: "quick_reply" | "url"; index?: string; parameters: Array<{ type: "text"; text: string } | { type: "payload"; payload: string }> };

export const sendTemplate = (token: string, phoneNumberId: string, to: string, name: string, language: string, components: TemplateComponent[], format?: RecipientFormat) =>
  sendMessage(token, phoneNumberId, { to, type: "template", template: { name, language: { code: language }, components } }, format);

/** Mensaje de texto libre: solo dentro de las 24 h posteriores a una respuesta del destinatario. */
export const sendText = (token: string, phoneNumberId: string, to: string, text: string, format?: RecipientFormat) =>
  sendMessage(token, phoneNumberId, { to, type: "text", text: { body: text.slice(0, 1000), preview_url: false } }, format);

/** Mensaje con botones de respuesta (también dentro de las 24 h): se usa para confirmar una cancelación. */
export const sendButtons = (token: string, phoneNumberId: string, to: string, text: string, buttons: Array<{ id: string; title: string }>, format?: RecipientFormat) =>
  sendMessage(
    token,
    phoneNumberId,
    {
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: text.slice(0, 1000) },
        action: { buttons: buttons.slice(0, 3).map((button) => ({ type: "reply", reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) } })) },
      },
    },
    format,
  );

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
