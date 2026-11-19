import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { callingCodeForTimezone, toWhatsAppNumber } from "@/lib/phone";

type Client = typeof db | Prisma.TransactionClient;

/**
 * Consentimiento del destinatario (política de mensajería de WhatsApp Business): sin un consentimiento explícito y
 * vigente de ESTE negocio no se envía ningún aviso. Se guarda qué texto se mostró (versión), cuándo y por qué vía, y se
 * revoca con la respuesta «BAJA» (o el bloqueo del contacto), que se respeta siempre.
 */
export const CONSENT_TEXT_VERSION = "2026-11-v1";
export { CONSENT_TEXT } from "./consent-text";

export type ConsentSource = "public_booking" | "dashboard" | "reply_stop";

/** Número en formato internacional (solo dígitos) o null si no es válido. */
export function normalizePhone(raw: string | null | undefined, timeZone: string): string | null {
  const parsed = toWhatsAppNumber(raw, callingCodeForTimezone(timeZone));
  return parsed.ok ? parsed.digits : null;
}

export async function grantConsent(
  client: Client,
  params: { organizationId: string; phone: string; customerId?: string | null; source: Exclude<ConsentSource, "reply_stop"> },
): Promise<void> {
  await client.whatsappConsent.upsert({
    where: { organizationId_phone: { organizationId: params.organizationId, phone: params.phone } },
    create: { organizationId: params.organizationId, phone: params.phone, customerId: params.customerId ?? null, status: "granted", source: params.source, textVersion: CONSENT_TEXT_VERSION },
    update: { status: "granted", source: params.source, textVersion: CONSENT_TEXT_VERSION, grantedAt: new Date(), revokedAt: null, ...(params.customerId ? { customerId: params.customerId } : {}) },
  });
}

export async function revokeConsent(client: Client, params: { organizationId: string; phone: string }): Promise<boolean> {
  const result = await client.whatsappConsent.updateMany({
    where: { organizationId: params.organizationId, phone: params.phone, status: "granted" },
    data: { status: "revoked", revokedAt: new Date(), source: "reply_stop" },
  });
  return result.count > 0;
}

export async function hasActiveConsent(client: Client, organizationId: string, phone: string): Promise<boolean> {
  const row = await client.whatsappConsent.findUnique({ where: { organizationId_phone: { organizationId, phone } }, select: { status: true } });
  return row?.status === "granted";
}
