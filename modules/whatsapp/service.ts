import "server-only";

import type { Appointment, Notification, Organization, WhatsappConnection } from "@prisma/client";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { decryptCredentials, encryptCredentials, hintOf, newVerifyToken, sha256Hex, type WhatsappCredentials } from "./crypto";
import { MetaError, type RecipientFormat, createTemplate, getPhoneNumber, listTemplates, sendButtons, sendTemplate, sendText } from "./meta";
import { hasActiveConsent } from "./consent";
import { TEMPLATES, TEMPLATE_LANGUAGE, WHATSAPP_KINDS, metaTemplateDefinition, templateComponents, whatsappKindOf, type WhatsappKind } from "./templates";

/** Estados de una plantilla en Meta que le importan a Agendia. */
export type TemplateStatuses = Partial<Record<WhatsappKind, string>>;

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function getConnection(organizationId: string): Promise<WhatsappConnection | null> {
  return db.whatsappConnection.findUnique({ where: { organizationId } });
}

/** Mensajes salientes del mes que cuentan contra el límite (los de prueba y los fallidos no). */
export async function monthlyUsage(organizationId: string, now = new Date()): Promise<{ used: number; failed: number }> {
  const since = monthStart(now);
  const [used, failed] = await Promise.all([
    db.whatsappMessage.count({ where: { organizationId, direction: "outbound", isTest: false, status: { not: "failed" }, createdAt: { gte: since } } }),
    db.whatsappMessage.count({ where: { organizationId, direction: "outbound", isTest: false, status: "failed", createdAt: { gte: since } } }),
  ]);
  return { used, failed };
}

function credentialsOf(connection: WhatsappConnection): WhatsappCredentials {
  if (!connection.credentials) throw new Error("Este negocio no tiene credenciales de WhatsApp cargadas.");
  return decryptCredentials(connection.credentials);
}

// ---- Alta y mantenimiento de la conexión (lo usa /admin) -------------------------------------------------------------

export type ConnectionInput = {
  phoneNumberId: string;
  wabaId: string;
  /** Si no se informan, se conservan las ya guardadas (cambiar solo el número no obliga a volver a pegarlas). */
  accessToken?: string;
  appSecret?: string;
  templateLanguage?: string;
};

const ID = /^\d{5,24}$/;

export async function saveConnection(organizationId: string, input: ConnectionInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const phoneNumberId = input.phoneNumberId.trim();
  const wabaId = input.wabaId.trim();
  if (!ID.test(phoneNumberId) || !ID.test(wabaId)) return { ok: false, message: "El identificador del número y el de la cuenta de WhatsApp Business son solo dígitos." };

  const existing = await getConnection(organizationId);
  const token = input.accessToken?.trim();
  const secret = input.appSecret?.trim();
  if (!existing?.credentials && (!token || !secret)) return { ok: false, message: "Falta el token de acceso y el secreto de la aplicación de Meta." };

  let credentials = existing?.credentials ?? null;
  let hint = existing?.credentialsHint ?? null;
  if (token || secret) {
    const current = existing?.credentials ? decryptCredentials(existing.credentials) : null;
    const next: WhatsappCredentials = { accessToken: token || current!.accessToken, appSecret: secret || current!.appSecret };
    credentials = encryptCredentials(next);
    hint = hintOf(next.accessToken);
  }

  // Cualquier cambio de número o de credenciales exige validar de nuevo y deja la conexión apagada.
  const changed = !existing || existing.phoneNumberId !== phoneNumberId || existing.wabaId !== wabaId || Boolean(token || secret);
  const data = {
    phoneNumberId,
    wabaId,
    credentials,
    credentialsHint: hint,
    templateLanguage: input.templateLanguage?.trim() || existing?.templateLanguage || TEMPLATE_LANGUAGE,
    ...(changed ? { status: "not_validated", statusDetail: "Credenciales nuevas: falta validar la conexión.", validatedAt: null, enabled: false, templatesStatus: undefined } : {}),
  };
  try {
    await db.whatsappConnection.upsert({ where: { organizationId }, create: { organizationId, ...data, templatesStatus: undefined }, update: data });
  } catch (error) {
    if (String(error).includes("P2002") || /unique constraint/i.test(String(error))) {
      return { ok: false, message: "Ese número de WhatsApp ya está conectado a otro negocio." };
    }
    throw error;
  }
  return { ok: true };
}

/** Genera el token que se pega en Meta para verificar el webhook. Se devuelve UNA vez; se guarda solo su hash. */
export async function issueVerifyToken(organizationId: string): Promise<string> {
  const token = newVerifyToken();
  await db.whatsappConnection.update({ where: { organizationId }, data: { verifyTokenHash: sha256Hex(token) } });
  return token;
}

export async function revokeCredentials(organizationId: string): Promise<void> {
  await db.whatsappConnection.updateMany({
    where: { organizationId },
    data: { credentials: null, credentialsHint: null, verifyTokenHash: null, enabled: false, status: "not_validated", statusDetail: "Credenciales revocadas.", validatedAt: null },
  });
}

export type ValidationResult = { ok: true; displayPhone: string | null; verifiedName: string | null; templates: TemplateStatuses } | { ok: false; message: string };

/** Comprueba contra Meta que el token sirve para ese número y lee el estado de las plantillas. */
export async function validateConnection(organizationId: string): Promise<ValidationResult> {
  const connection = await getConnection(organizationId);
  if (!connection?.credentials || !connection.phoneNumberId || !connection.wabaId) return { ok: false, message: "Faltan datos de la conexión." };
  try {
    const { accessToken } = credentialsOf(connection);
    const phone = await getPhoneNumber(accessToken, connection.phoneNumberId);
    const remote = await listTemplates(accessToken, connection.wabaId);
    const templates: TemplateStatuses = {};
    for (const kind of WHATSAPP_KINDS) {
      const found = remote.find((template) => template.name === TEMPLATES[kind].name && template.language === connection.templateLanguage);
      templates[kind] = found?.status ?? "MISSING";
    }
    await db.whatsappConnection.update({
      where: { organizationId },
      data: {
        status: "connected",
        statusDetail: null,
        validatedAt: new Date(),
        displayPhone: phone.display_phone_number ?? null,
        verifiedName: phone.verified_name ?? null,
        qualityRating: phone.quality_rating ?? null,
        templatesStatus: templates,
      },
    });
    return { ok: true, displayPhone: phone.display_phone_number ?? null, verifiedName: phone.verified_name ?? null, templates };
  } catch (error) {
    const message = error instanceof MetaError || error instanceof Error ? error.message : "Error desconocido";
    await db.whatsappConnection.update({ where: { organizationId }, data: { status: "error", statusDetail: message.slice(0, 300), enabled: false, validatedAt: null } });
    return { ok: false, message };
  }
}

/** Crea en la cuenta de WhatsApp del negocio las plantillas que falten y actualiza su estado. */
/** Los botones de enlace de las plantillas apuntan a este origen. Meta exige una dirección https pública: en un entorno local se fija `WHATSAPP_TEMPLATE_BASE_URL`. */
function templateBaseUrl(): string {
  return process.env.WHATSAPP_TEMPLATE_BASE_URL?.trim().replace(/\/$/, "") || brand.url;
}

export async function syncTemplates(organizationId: string): Promise<{ ok: true; created: WhatsappKind[]; templates: TemplateStatuses } | { ok: false; message: string }> {
  const connection = await getConnection(organizationId);
  if (!connection?.credentials || !connection.wabaId) return { ok: false, message: "Faltan datos de la conexión." };
  try {
    const { accessToken } = credentialsOf(connection);
    const remote = await listTemplates(accessToken, connection.wabaId);
    const created: WhatsappKind[] = [];
    const failed: string[] = [];
    for (const kind of WHATSAPP_KINDS) {
      const exists = remote.some((template) => template.name === TEMPLATES[kind].name && template.language === connection.templateLanguage);
      if (exists) continue; // idempotente: lo que ya está en Meta no se vuelve a crear
      try {
        await createTemplate(accessToken, connection.wabaId, metaTemplateDefinition(kind, templateBaseUrl(), connection.templateLanguage));
        created.push(kind);
      } catch (error) {
        if (error instanceof MetaError && error.status === 401) throw error; // credenciales inválidas: no tiene sentido seguir
        // Una plantilla que Meta rechaza no impide crear las demás: se informa cuál falló y por qué.
        failed.push(`«${TEMPLATES[kind].name}»: ${error instanceof Error ? error.message : "error desconocido"}`);
      }
    }
    const refreshed = await listTemplates(accessToken, connection.wabaId);
    const templates: TemplateStatuses = {};
    for (const kind of WHATSAPP_KINDS) {
      templates[kind] = refreshed.find((template) => template.name === TEMPLATES[kind].name && template.language === connection.templateLanguage)?.status ?? "MISSING";
    }
    await db.whatsappConnection.update({ where: { organizationId }, data: { templatesStatus: templates } });
    if (failed.length > 0) return { ok: false, message: `No se pudieron crear ${failed.length === 1 ? "la plantilla" : "las plantillas"} ${failed.join(" · ")}`.slice(0, 900) };
    return { ok: true, created, templates };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Error desconocido" };
  }
}

export async function setEnabled(organizationId: string, enabled: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const connection = await getConnection(organizationId);
  if (enabled && (!connection || connection.status !== "connected")) return { ok: false, message: "Validá la conexión antes de activar WhatsApp." };
  await db.whatsappConnection.updateMany({ where: { organizationId }, data: { enabled } });
  return { ok: true };
}

export type SettingsInput = Partial<Pick<WhatsappConnection, "sendConfirmations" | "sendReminders" | "reminderHoursBefore" | "sendCancellations" | "sendReschedules">>;

export async function updateSettings(organizationId: string, input: SettingsInput): Promise<void> {
  const hours = input.reminderHoursBefore;
  await db.whatsappConnection.updateMany({
    where: { organizationId },
    data: { ...input, ...(hours !== undefined ? { reminderHoursBefore: Math.min(168, Math.max(1, Math.trunc(hours))) } : {}) },
  });
}

export async function setLimits(organizationId: string, params: { monthlyLimit?: number; testRecipients?: string[] }): Promise<void> {
  await db.whatsappConnection.updateMany({
    where: { organizationId },
    data: {
      ...(params.monthlyLimit !== undefined ? { monthlyLimit: Math.min(100000, Math.max(0, Math.trunc(params.monthlyLimit))) } : {}),
      ...(params.testRecipients ? { testRecipients: [...new Set(params.testRecipients)] } : {}),
    },
  });
}

// ---- Envío ---------------------------------------------------------------------------------------------------------

export type DeliveryOutcome = { kind: "sent" } | { kind: "retry"; error: string } | { kind: "failed"; error: string } | { kind: "skipped"; reason: string };

type DeliverParams = {
  notification: Notification;
  organization: Organization;
  appointment: Appointment & { service: { name: string }; customer: { name: string }; professional: { displayName: string } };
  /** Solo en negocios con equipo se dice quién atiende. */
  showProfessional: boolean;
};

/**
 * Envía UN aviso por WhatsApp (lo llama el procesador del outbox). Garantías:
 * - un solo envío por notificación: la fila de historial es única por notificación; si un intento anterior quedó en un
 *   estado incierto (se cortó entre llamar a Meta y guardar el resultado) NO se reenvía, para no duplicar el mensaje;
 * - solo con WhatsApp activo y conectado, el aviso habilitado, consentimiento vigente y bajo el límite mensual;
 * - solo con la plantilla aprobada en la cuenta de ese negocio;
 * - los errores definitivos (número sin WhatsApp, plantilla rechazada, token vencido…) no se reintentan.
 */
export async function deliverNotification(params: DeliverParams): Promise<DeliveryOutcome> {
  const { notification, organization, appointment } = params;
  const kind = whatsappKindOf(notification.type);
  if (!kind) return { kind: "skipped", reason: "Este aviso no se envía por WhatsApp." };

  const connection = await getConnection(organization.id);
  if (!connection || !connection.enabled || connection.status !== "connected" || !connection.credentials || !connection.phoneNumberId) {
    return { kind: "skipped", reason: "WhatsApp no está activo para este negocio." };
  }
  const allowed =
    (kind === "booking_confirmation" && connection.sendConfirmations) ||
    (kind === "reminder" && connection.sendReminders) ||
    (kind === "cancellation" && connection.sendCancellations) ||
    (kind === "reschedule" && connection.sendReschedules);
  if (!allowed) return { kind: "skipped", reason: "Este aviso está desactivado en la configuración." };

  const phone = notification.recipient;
  if (!(await hasActiveConsent(db, organization.id, phone))) return { kind: "skipped", reason: "El cliente no dio su consentimiento para recibir WhatsApp." };

  const status = (connection.templatesStatus as TemplateStatuses | null)?.[kind];
  if (status !== "APPROVED") return { kind: "failed", error: `La plantilla «${TEMPLATES[kind].name}» no está aprobada en Meta (estado: ${status ?? "sin sincronizar"}).` };

  const existing = await db.whatsappMessage.findUnique({ where: { notificationId: notification.id } });
  if (existing?.providerMessageId) return { kind: "sent" };
  if (existing?.status === "sending" || existing?.status === "unknown") {
    await db.whatsappMessage.update({ where: { id: existing.id }, data: { status: "unknown", errorMessage: "Resultado incierto de un intento anterior." } });
    return { kind: "failed", error: "Resultado incierto de un intento anterior: no se reenvía para no duplicar el mensaje." };
  }

  const { used } = await monthlyUsage(organization.id);
  if (!existing && used >= connection.monthlyLimit) return { kind: "failed", error: `Se alcanzó el límite mensual de ${connection.monthlyLimit} mensajes.` };

  const row = existing
    ? await db.whatsappMessage.update({ where: { id: existing.id }, data: { status: "sending", errorCode: null, errorMessage: null } })
    : await db.whatsappMessage.create({
        data: {
          organizationId: organization.id,
          appointmentId: appointment.id,
          notificationId: notification.id,
          direction: "outbound",
          kind,
          phone,
          templateName: TEMPLATES[kind].name,
          status: "sending",
        },
      });

  try {
    const { accessToken } = credentialsOf(connection);
    const components = templateComponents(
      kind,
      {
        customerFirstName: appointment.customer.name.split(" ")[0],
        organizationName: organization.name,
        serviceName: appointment.service.name,
        when: formatDateTime(appointment.startsAt, organization.timezone),
        professionalName: params.showProfessional ? appointment.professional.displayName : null,
      },
      { appointmentToken: appointment.manageToken, organizationSlug: organization.slug },
    );
    const sent = await sendTemplate(accessToken, connection.phoneNumberId, phone, TEMPLATES[kind].name, connection.templateLanguage, components, recipientFormatFor(connection, organization));
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "sent", providerMessageId: sent.messageId } });
    return { kind: "sent" };
  } catch (error) {
    const meta = error instanceof MetaError ? error : null;
    const message = (error instanceof Error ? error.message : "Error desconocido").slice(0, 300);
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "failed", errorCode: meta?.code ?? null, errorMessage: message } });
    if (meta?.code === "190") {
      // Token vencido o revocado: la conexión deja de estar sana y se apaga hasta que se cargue uno nuevo.
      await db.whatsappConnection.update({ where: { organizationId: organization.id }, data: { status: "error", statusDetail: "El token de acceso es inválido o venció.", enabled: false } });
    }
    return meta?.retryable === false || !meta ? { kind: "failed", error: message } : { kind: "retry", error: message };
  }
}

/** Respuesta dentro de las 24 h (texto o botones), registrada en el historial. No se bloquea por el límite: una baja siempre se confirma. */
export async function sendSessionReply(
  organizationId: string,
  params: { to: string; appointmentId?: string | null; text: string; buttons?: Array<{ id: string; title: string }> },
): Promise<void> {
  const connection = await getConnection(organizationId);
  if (!connection?.credentials || !connection.phoneNumberId) return;
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true, demoKind: true } });
  const format = organization ? recipientFormatFor(connection, organization) : undefined;
  const row = await db.whatsappMessage.create({ data: { organizationId, appointmentId: params.appointmentId ?? null, direction: "outbound", kind: "reply", phone: params.to, status: "sending" } });
  try {
    const { accessToken } = credentialsOf(connection);
    const sent = params.buttons ? await sendButtons(accessToken, connection.phoneNumberId, params.to, params.text, params.buttons, format) : await sendText(accessToken, connection.phoneNumberId, params.to, params.text, format);
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "sent", providerMessageId: sent.messageId } });
  } catch (error) {
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "failed", errorCode: error instanceof MetaError ? error.code : null, errorMessage: (error instanceof Error ? error.message : "Error").slice(0, 300) } });
  }
}

/** Los destinatarios de prueba son los que autorizó Meta para su número de prueba: ahí el móvil argentino va sin el 9. */
const TEST_RECIPIENT_FORMAT: RecipientFormat = "ar-without-9";

/** Los números de prueba que entrega Meta son estadounidenses ficticios: +1 555 xxx xxxx. */
const META_TEST_NUMBER = /^1555\d{7}$/;

/**
 * ¿Esta conexión usa el número de PRUEBA de Meta? Solo entonces los destinatarios se entregan en el formato de su lista
 * autorizada. Se exige TODO junto: demo supervisada (nunca un negocio real) y que el número que Meta informó al validar la
 * conexión sea de prueba; una demo con un número propio, o cualquier negocio real, conserva el formato predeterminado.
 */
export function usesMetaTestNumber(connection: { displayPhone: string | null }, organization: { isDemo: boolean; demoKind: string | null }): boolean {
  return organization.isDemo && organization.demoKind === "supervised" && META_TEST_NUMBER.test((connection.displayPhone ?? "").replace(/\D/g, ""));
}

/** Formato del destinatario para esta conexión; `undefined` deja el predeterminado (e164, o el de WHATSAPP_AR_RECIPIENT_FORMAT). */
export const recipientFormatFor = (connection: { displayPhone: string | null }, organization: { isDemo: boolean; demoKind: string | null }): RecipientFormat | undefined =>
  usesMetaTestNumber(connection, organization) ? "ar-without-9" : undefined;

/**
 * Envío de prueba autorizado: solo a un número de la lista de prueba del negocio, con la plantilla `hello_world` (que
 * toda cuenta de Meta trae aprobada) o con una de las propias. Queda en el historial marcado como prueba y no cuenta
 * contra el límite.
 */
export async function sendTest(organizationId: string, params: { to: string; template: "hello_world" | WhatsappKind }): Promise<{ ok: true } | { ok: false; message: string }> {
  const connection = await getConnection(organizationId);
  if (!connection?.credentials || !connection.phoneNumberId) return { ok: false, message: "Faltan datos de la conexión." };
  if (connection.status !== "connected") return { ok: false, message: "Validá la conexión antes de enviar una prueba." };
  if (!connection.testRecipients.includes(params.to)) return { ok: false, message: "Ese número no está en la lista de destinatarios de prueba autorizados." };

  const row = await db.whatsappMessage.create({
    data: { organizationId, direction: "outbound", kind: "test", phone: params.to, templateName: params.template === "hello_world" ? "hello_world" : TEMPLATES[params.template].name, status: "sending", isTest: true },
  });
  try {
    const { accessToken } = credentialsOf(connection);
    const sent =
      params.template === "hello_world"
        ? await sendTemplate(accessToken, connection.phoneNumberId, params.to, "hello_world", "en_US", [], TEST_RECIPIENT_FORMAT)
        : await sendTemplate(
            accessToken,
            connection.phoneNumberId,
            params.to,
            TEMPLATES[params.template].name,
            connection.templateLanguage,
            templateComponents(
              params.template,
              { customerFirstName: "Prueba", organizationName: "Agendia", serviceName: "Turno de prueba", when: "mañana, 10:00" },
              { appointmentToken: "prueba", organizationSlug: "prueba" },
            ),
            TEST_RECIPIENT_FORMAT,
          );
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "sent", providerMessageId: sent.messageId } });
    return { ok: true };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Error").slice(0, 300);
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "failed", errorCode: error instanceof MetaError ? error.code : null, errorMessage: message } });
    return { ok: false, message };
  }
}
