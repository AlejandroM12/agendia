// Cliente mínimo de la API de Mercado Pago para los scripts de prueba. Lee .env.mp-test y NUNCA imprime credenciales.
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

export const env = parse(readFileSync(".env.mp-test"));
const API = "https://api.mercadopago.com";

export async function mp(method, path, body, { token = env.MERCADOPAGO_ACCESS_TOKEN, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: response.status, ok: response.ok, json };
}

export const pick = (object, keys) => Object.fromEntries(keys.filter((k) => object?.[k] !== undefined).map((k) => [k, object[k]]));
