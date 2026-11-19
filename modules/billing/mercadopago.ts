import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cliente mínimo de Mercado Pago sobre su API HTTP: suscripciones
 * ("preapproval") para el plan mensual y pagos únicos (Checkout Pro) para
 * la licencia independiente. Sin credenciales (MERCADOPAGO_ACCESS_TOKEN y
 * MERCADOPAGO_WEBHOOK_SECRET) la integración se considera apagada y la
 * aplicación no ofrece el pago online.
 */

const API = "https://api.mercadopago.com";

/**
 * Modo de las credenciales cargadas, que se declara a mano (`MERCADOPAGO_MODE`) porque un access token de
 * prueba y uno de producción no se distinguen por el prefijo:
 *  - `live`: credenciales de producción; cualquiera puede pagar.
 *  - `test`: credenciales de prueba; solo pueden pagar las cuentas de `MERCADOPAGO_TEST_EMAILS`, así un
 *    token de prueba cargado en el servidor público no habilita «pagos» que no cobran nada a visitantes reales.
 * Sin modo declarado el pago online queda apagado (el valor por defecto es el seguro).
 */
export type MercadoPagoMode = "live" | "test";

export function mercadoPagoMode(): MercadoPagoMode | null {
  const value = process.env.MERCADOPAGO_MODE?.trim().toLowerCase();
  return value === "live" || value === "test" ? value : null;
}

function testEmails(): string[] {
  return (process.env.MERCADOPAGO_TEST_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isMercadoPagoConfigured(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN && process.env.MERCADOPAGO_WEBHOOK_SECRET && mercadoPagoMode());
}

/** ¿Esta persona puede iniciar un pago online? En modo `test`, solo si su email está autorizado. */
export function canPayOnline(email: string | null | undefined): boolean {
  if (!isMercadoPagoConfigured()) return false;
  if (mercadoPagoMode() === "live") return true;
  return Boolean(email) && testEmails().includes(String(email).trim().toLowerCase());
}

/** ¿Se muestra el formulario público de compra de licencia? En modo `test` solo si hay cuentas autorizadas. */
export function onlinePaymentVisible(): boolean {
  if (!isMercadoPagoConfigured()) return false;
  return mercadoPagoMode() === "live" || testEmails().length > 0;
}

export type Preapproval = {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled" | string;
  external_reference?: string | null;
  init_point?: string | null;
  next_payment_date?: string | null;
  payer_email?: string | null;
  /** Importe y moneda que Mercado Pago cobra en cada período: se verifican contra lo que enviamos. */
  auto_recurring?: { transaction_amount?: number | null; currency_id?: string | null; start_date?: string | null } | null;
  /** Resumen de cobros; solo informativo (no se usa para habilitar nada). */
  summarized?: { charged_quantity?: number | null; last_charged_date?: string | null } | null;
};

export type AuthorizedPayment = {
  id: number | string;
  preapproval_id?: string | null;
  status?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  payment?: { id?: number | string; status?: string | null } | null;
};

/** Error de la API con su código HTTP, para distinguir «no existe» (404) de un fallo real. */
export class MercadoPagoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MercadoPagoError";
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof MercadoPagoError && error.status === 404;
}

/** Esperas entre reintentos de una consulta (GET) ante un límite de uso (429) o un error transitorio del servidor. */
const RETRY_DELAYS_MS = [700, 1800];
const TRANSIENT = new Set([429, 502, 503, 504]);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("Mercado Pago no está configurado.");

  let response: Response;
  // Solo las consultas se reintentan: repetir un POST podría crear dos suscripciones o dos preferencias.
  for (let attempt = 0; ; attempt++) {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (method !== "GET" || !TRANSIENT.has(response.status) || attempt >= RETRY_DELAYS_MS.length) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new MercadoPagoError(response.status, `Mercado Pago respondió ${response.status} en ${method} ${path}: ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export type CredentialsKind = "test" | "live" | "unknown";

let detected: CredentialsKind | null = null;

/**
 * ¿Las credenciales cargadas son de una cuenta de PRUEBA o de producción? Mercado Pago ya no distingue el access token
 * por el prefijo (los dos empiezan con `APP_USR-`), pero la cuenta dueña de un token de prueba es un usuario de prueba
 * (`GET /users/me` trae la etiqueta `test_user`). Se consulta una vez por proceso y se recuerda.
 */
export async function detectCredentialsKind(): Promise<CredentialsKind> {
  if (detected) return detected;
  try {
    const me = await request<{ tags?: string[] | null }>("GET", "/users/me");
    detected = Array.isArray(me.tags) && me.tags.includes("test_user") ? "test" : "live";
    return detected;
  } catch {
    return "unknown"; // no se recuerda: se vuelve a intentar en la próxima operación
  }
}

/** Solo para pruebas: olvida el tipo detectado. */
export function resetDetectedCredentialsKind() {
  detected = null;
}

/**
 * Corta cualquier operación que mueva dinero si `MERCADOPAGO_MODE` contradice a las credenciales: credenciales de prueba
 * declaradas como `live` (el sitio ofrecería «pagos» que no cobran) o credenciales de producción declaradas como `test`
 * (una cuenta autorizada podría generar un cobro real sin querer).
 */
export async function assertCredentialsMatchMode(): Promise<void> {
  const mode = mercadoPagoMode();
  if (!mode) throw new Error("Mercado Pago: falta MERCADOPAGO_MODE (live o test).");
  const kind = await detectCredentialsKind();
  if (kind === "unknown") return;
  if ((mode === "live" && kind === "test") || (mode === "test" && kind === "live")) {
    throw new Error(`Mercado Pago: MERCADOPAGO_MODE=${mode}, pero las credenciales cargadas son de ${kind === "test" ? "PRUEBA" : "PRODUCCIÓN"}. No se crea ningún cobro.`);
  }
}

export async function createPreapproval(params: {
  organizationId: string;
  payerEmail: string;
  reason: string;
  amount: number;
  currency: string;
  backUrl: string;
  /** Primer cobro diferido (cambio de plan al fin del período ya pago). Por defecto, al autorizar. */
  startDate?: Date;
}): Promise<Preapproval> {
  await assertCredentialsMatchMode();
  return request<Preapproval>("POST", "/preapproval", {
    reason: params.reason,
    external_reference: params.organizationId,
    payer_email: params.payerEmail,
    back_url: params.backUrl,
    status: "pending",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: params.amount,
      currency_id: params.currency,
      ...(params.startDate ? { start_date: params.startDate.toISOString() } : {}),
    },
  });
}

export const getPreapproval = (id: string) =>
  request<Preapproval>("GET", `/preapproval/${encodeURIComponent(id)}`);

export const cancelPreapproval = (id: string) =>
  request<Preapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });

export const getAuthorizedPayment = (id: string) =>
  request<AuthorizedPayment>("GET", `/authorized_payments/${encodeURIComponent(id)}`);

/**
 * Cobros de una suscripción (`GET /authorized_payments/search?preapproval_id=`). Es lo que permite recuperar un cobro
 * cuyo aviso (webhook) no llegó. Verificado contra el sandbox el 2026-11-19.
 */
export async function searchAuthorizedPayments(preapprovalId: string): Promise<AuthorizedPayment[]> {
  const result = await request<{ results?: AuthorizedPayment[] }>(
    "GET",
    `/authorized_payments/search?${new URLSearchParams({ preapproval_id: preapprovalId })}`,
  );
  return result.results ?? [];
}

export type Payment = {
  id: number | string;
  status: "approved" | "rejected" | "pending" | "in_process" | "cancelled" | "refunded" | "charged_back" | string;
  external_reference?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  date_approved?: string | null;
};

export type Preference = { id: string; init_point?: string | null };

/** Pago único (Checkout Pro). Se usa para la compra de la licencia independiente. */
export async function createPreference(params: {
  externalReference: string;
  title: string;
  amount: number;
  currency: string;
  payer: { email: string; name: string };
  returnUrl: string;
}): Promise<Preference> {
  await assertCredentialsMatchMode();
  return request<Preference>("POST", "/checkout/preferences", {
    items: [
      { id: "licencia", title: params.title, quantity: 1, unit_price: params.amount, currency_id: params.currency },
    ],
    payer: { email: params.payer.email, name: params.payer.name },
    external_reference: params.externalReference,
    back_urls: { success: params.returnUrl, pending: params.returnUrl, failure: params.returnUrl },
    // Mercado Pago solo acepta el retorno automático hacia URLs https.
    ...(params.returnUrl.startsWith("https://") ? { auto_return: "approved" } : {}),
  });
}

export const getPayment = (id: string) => request<Payment>("GET", `/v1/payments/${encodeURIComponent(id)}`);

export async function searchPaymentsByReference(externalReference: string): Promise<Payment[]> {
  const query = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "desc" });
  const result = await request<{ results?: Payment[] }>("GET", `/v1/payments/search?${query}`);
  return result.results ?? [];
}

/**
 * Valida la firma de un webhook (header `x-signature: ts=…,v1=…`).
 *
 * El manifiesto firmado es `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * y la firma, un HMAC-SHA256 con el secreto del webhook. Se compara en
 * tiempo constante y se rechazan firmas con más de 10 minutos de antigüedad.
 */
export function verifyWebhookSignature(params: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string;
  now?: number;
}): boolean {
  const { signatureHeader, requestId, dataId, secret } = params;
  if (!signatureHeader || !secret) return false;

  const parts = new Map(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key.trim(), rest.join("=").trim()] as const;
    }),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;

  const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
  if (!Number.isFinite(tsMs) || Math.abs((params.now ?? Date.now()) - tsMs) > 10 * 60 * 1000) return false;

  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest();
  const received = Buffer.from(v1, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
