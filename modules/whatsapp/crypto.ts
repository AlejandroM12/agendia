import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de las credenciales de WhatsApp de cada negocio (AES-256-GCM, con autenticación).
 *
 * Hay UNA clave de plataforma, que se configura una sola vez al desplegar (`WHATSAPP_ENCRYPTION_KEY`, 32 bytes en
 * base64): incorporar un negocio nuevo no requiere tocar variables de entorno. Las credenciales de cada negocio viven
 * cifradas en la base y nunca se muestran ni se registran.
 *
 * Rotación: se pone la clave nueva en `WHATSAPP_ENCRYPTION_KEY` y la anterior en `WHATSAPP_ENCRYPTION_KEY_PREVIOUS`;
 * lo cifrado con la anterior se sigue leyendo y se vuelve a cifrar al guardar. Formato:
 * `v1.<id de clave>.<iv>.<etiqueta>.<texto cifrado>` (base64url).
 */
const VERSION = "v1";

function parseKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);

export function isEncryptionConfigured(): boolean {
  return parseKey(process.env.WHATSAPP_ENCRYPTION_KEY) !== null;
}

function currentKey(): Buffer {
  const key = parseKey(process.env.WHATSAPP_ENCRYPTION_KEY);
  if (!key) {
    throw new Error("Falta WHATSAPP_ENCRYPTION_KEY (32 bytes en base64, p. ej. `openssl rand -base64 32`): no se pueden guardar credenciales.");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, keyId(key), iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, id, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !id || !iv || !tag || !data) throw new Error("Credencial cifrada con un formato desconocido.");
  const candidates = [parseKey(process.env.WHATSAPP_ENCRYPTION_KEY), parseKey(process.env.WHATSAPP_ENCRYPTION_KEY_PREVIOUS)].filter((key): key is Buffer => key !== null);
  const key = candidates.find((candidate) => keyId(candidate) === id);
  if (!key) throw new Error("La clave de cifrado de estas credenciales ya no está configurada.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export type WhatsappCredentials = { accessToken: string; appSecret: string };

export function encryptCredentials(credentials: WhatsappCredentials): string {
  return encryptSecret(JSON.stringify(credentials));
}

export function decryptCredentials(stored: string): WhatsappCredentials {
  const parsed = JSON.parse(decryptSecret(stored)) as Partial<WhatsappCredentials>;
  if (!parsed.accessToken || !parsed.appSecret) throw new Error("Credenciales incompletas.");
  return { accessToken: parsed.accessToken, appSecret: parsed.appSecret };
}

/** Los últimos caracteres de un secreto, solo para reconocerlo en pantalla (nunca el valor completo). */
export function hintOf(secret: string): string {
  return secret.length <= 8 ? "••••" : `…${secret.slice(-4)}`;
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Token aleatorio para verificar el webhook; se muestra una vez y se guarda solo su hash. */
export function newVerifyToken(): string {
  return randomBytes(24).toString("base64url");
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
