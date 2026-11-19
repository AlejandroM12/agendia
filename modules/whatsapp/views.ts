import "server-only";

import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { monthlyUsage, type TemplateStatuses } from "./service";

/**
 * Lo que se muestra de una conexión: SIN credenciales (ni siquiera cifradas). Solo los últimos caracteres del token para
 * reconocerlo. Lo comparten /admin y la sección Integraciones del negocio.
 */
export type WhatsappView = {
  exists: boolean;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhone: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  credentialsHint: string | null;
  hasVerifyToken: boolean;
  templateLanguage: string;
  templates: TemplateStatuses;
  settings: { sendConfirmations: boolean; sendReminders: boolean; reminderHoursBefore: number; sendCancellations: boolean; sendReschedules: boolean };
  monthlyLimit: number;
  testRecipients: string[];
  usage: { used: number; failed: number };
  webhookUrl: string;
  messages: Array<{ id: string; at: Date; direction: string; kind: string; phone: string | null; status: string; errorMessage: string | null; isTest: boolean; body: string | null }>;
  consents: { granted: number; revoked: number };
};

export async function getWhatsappView(organizationId: string, options: { messages?: number } = {}): Promise<WhatsappView> {
  const connection = await db.whatsappConnection.findUnique({ where: { organizationId } });
  const [messages, usage, granted, revoked] = await Promise.all([
    db.whatsappMessage.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: options.messages ?? 30 }),
    monthlyUsage(organizationId),
    db.whatsappConsent.count({ where: { organizationId, status: "granted" } }),
    db.whatsappConsent.count({ where: { organizationId, status: "revoked" } }),
  ]);
  return {
    exists: Boolean(connection),
    enabled: connection?.enabled ?? false,
    status: connection?.status ?? "not_validated",
    statusDetail: connection?.statusDetail ?? null,
    phoneNumberId: connection?.phoneNumberId ?? null,
    wabaId: connection?.wabaId ?? null,
    displayPhone: connection?.displayPhone ?? null,
    verifiedName: connection?.verifiedName ?? null,
    qualityRating: connection?.qualityRating ?? null,
    credentialsHint: connection?.credentialsHint ?? null,
    hasVerifyToken: Boolean(connection?.verifyTokenHash),
    templateLanguage: connection?.templateLanguage ?? "es_AR",
    templates: (connection?.templatesStatus as TemplateStatuses | null) ?? {},
    settings: {
      sendConfirmations: connection?.sendConfirmations ?? true,
      sendReminders: connection?.sendReminders ?? true,
      reminderHoursBefore: connection?.reminderHoursBefore ?? 24,
      sendCancellations: connection?.sendCancellations ?? true,
      sendReschedules: connection?.sendReschedules ?? true,
    },
    monthlyLimit: connection?.monthlyLimit ?? 300,
    testRecipients: connection?.testRecipients ?? [],
    usage,
    webhookUrl: `${brand.url}/api/webhooks/whatsapp`,
    messages: messages.map((m) => ({ id: m.id, at: m.createdAt, direction: m.direction, kind: m.kind, phone: m.phone, status: m.status, errorMessage: m.errorMessage, isTest: m.isTest, body: m.body })),
    consents: { granted, revoked },
  };
}

/** Teléfono para mostrar: solo los últimos dígitos (el panel del negocio no necesita el número completo en un listado). */
export const maskPhone = (phone: string | null) => (phone ? `…${phone.slice(-4)}` : "—");
