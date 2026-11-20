import "server-only";

import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { cancelAppointment } from "@/modules/appointments/service";
import { decryptCredentials, sha256Hex } from "./crypto";
import { normalizePhone, revokeConsent } from "./consent";
import { canonicalInboundNumber } from "@/lib/phone";
import { verifyMetaSignature } from "./meta";
import { sendSessionReply } from "./service";

/**
 * Webhook de la WhatsApp Cloud API: estados de entrega y respuestas de los destinatarios.
 *
 * Seguridad y aislamiento:
 * - Cada pedido se autentica con la firma `X-Hub-Signature-256` calculada con el secreto de la aplicación de Meta DE ESE
 *   negocio (el negocio se identifica por `metadata.phone_number_id`, que solo se usa para ELEGIR qué secreto probar:
 *   hasta que la firma valida, nada del cuerpo se toma como cierto).
 * - Toda acción sobre un turno exige que el turno sea del MISMO negocio que la conexión y, si Meta informa el número de
 *   quien responde, que coincida con el teléfono del cliente del turno. Un negocio nunca puede tocar turnos de otro.
 * - Es idempotente: Meta puede reenviar el mismo aviso hasta 7 días; cada mensaje entrante se procesa una sola vez.
 */
const STATUS_RANK: Record<string, number> = { queued: 0, sending: 0, sent: 1, delivered: 2, read: 3 };

type MetaStatus = { id?: string; status?: string; errors?: Array<{ code?: number | string; title?: string; message?: string }> };
type MetaMessage = {
  id?: string;
  from?: string;
  from_user_id?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
};
type MetaValue = { metadata?: { phone_number_id?: string }; statuses?: MetaStatus[]; messages?: MetaMessage[] };
type MetaPayload = { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: MetaValue }> }> };

/** Handshake inicial (GET): Meta envía el token que se cargó al configurar el webhook. */
export async function verifyHandshake(params: { mode: string | null; token: string | null; challenge: string | null }): Promise<string | null> {
  if (params.mode !== "subscribe" || !params.token || !params.challenge) return null;
  const match = await db.whatsappConnection.findUnique({ where: { verifyTokenHash: sha256Hex(params.token) }, select: { id: true } });
  return match ? params.challenge : null;
}

export type WebhookResult = { status: 200 | 400 | 401; body: Record<string, unknown> };

export async function processWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookResult> {
  let payload: MetaPayload;
  try {
    payload = JSON.parse(rawBody) as MetaPayload;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  if (payload.object !== "whatsapp_business_account") return { status: 200, body: { ok: true, ignored: true } };

  const changes = (payload.entry ?? []).flatMap((entry) => entry.changes ?? []).filter((change) => change.field === "messages" && change.value?.metadata?.phone_number_id);
  if (changes.length === 0) return { status: 200, body: { ok: true, ignored: true } };

  let known = 0;
  let accepted = 0;
  for (const change of changes) {
    const value = change.value!;
    const connection = await db.whatsappConnection.findUnique({ where: { phoneNumberId: value.metadata!.phone_number_id! } });
    if (!connection?.credentials) continue; // un número que no es de ningún negocio de Agendia: se ignora
    known++;
    let appSecret: string;
    try {
      appSecret = decryptCredentials(connection.credentials).appSecret;
    } catch {
      continue;
    }
    if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) continue;
    accepted++;
    await handleValue(connection.organizationId, value);
  }
  if (known > 0 && accepted === 0) return { status: 401, body: { error: "invalid_signature" } };
  return { status: 200, body: { ok: true } };
}

async function handleValue(organizationId: string, value: MetaValue): Promise<void> {
  for (const status of value.statuses ?? []) await applyStatus(organizationId, status);
  for (const message of value.messages ?? []) await applyInbound(organizationId, message);
}

async function applyStatus(organizationId: string, status: MetaStatus): Promise<void> {
  if (!status.id || !status.status) return;
  const row = await db.whatsappMessage.findUnique({ where: { organizationId_providerMessageId: { organizationId, providerMessageId: status.id } } });
  if (!row) return;
  if (status.status === "failed") {
    // Un fallo no pisa una entrega ya confirmada.
    if (STATUS_RANK[row.status] >= 2) return;
    const error = status.errors?.[0];
    await db.whatsappMessage.update({ where: { id: row.id }, data: { status: "failed", errorCode: error?.code !== undefined ? String(error.code) : null, errorMessage: (error?.message ?? error?.title ?? "Error de entrega").slice(0, 300) } });
    return;
  }
  const next = STATUS_RANK[status.status];
  if (next === undefined || next <= (STATUS_RANK[row.status] ?? 0)) return; // desordenado o repetido: no retrocede
  await db.whatsappMessage.update({ where: { id: row.id }, data: { status: status.status } });
}

const STOP_WORDS = /^\s*(baja|stop|parar|no quiero|darme de baja|dar de baja)\s*[.!]*\s*$/i;

async function applyInbound(organizationId: string, message: MetaMessage): Promise<void> {
  if (!message.id) return;
  const phone = message.from ? canonicalInboundNumber(message.from) : null;
  const action = message.button?.payload ?? message.interactive?.button_reply?.id ?? null;
  const text = (message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? "").slice(0, 200);

  try {
    await db.whatsappMessage.create({
      data: { organizationId, direction: "inbound", kind: "reply", phone, bsuid: message.from_user_id ?? null, status: "received", providerMessageId: message.id, body: text || null },
    });
  } catch (error) {
    if (String(error).includes("P2002") || /unique constraint/i.test(String(error))) return; // reenvío de un mensaje ya procesado
    throw error;
  }
  const reply = phone ?? null;
  if (!reply) return; // sin número no se puede contestar; queda registrado

  if (message.type === "text" && STOP_WORDS.test(message.text?.body ?? "")) {
    await optOut(organizationId, reply);
    return;
  }
  const match = action ? /^(c|x|cx|ck):([A-Za-z0-9_-]{20,100})$/.exec(action) : null;
  if (!match) return;
  await handleAppointmentAction(organizationId, reply, match[1].toLowerCase(), match[2]);
}

async function optOut(organizationId: string, phone: string): Promise<void> {
  const changed = await revokeConsent(db, { organizationId, phone });
  await db.notification.updateMany({ where: { organizationId, channel: "whatsapp", recipient: phone, status: "pending" }, data: { status: "canceled" } });
  if (!changed) return;
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  await sendSessionReply(organizationId, { to: phone, text: `Listo: no vas a recibir más avisos por WhatsApp de ${organization?.name ?? "este negocio"}. Si querés volver a recibirlos, podés pedirlo al reservar tu próximo turno.` });
}

async function handleAppointmentAction(organizationId: string, from: string, action: string, token: string): Promise<void> {
  const appointment = await db.appointment.findUnique({ where: { manageToken: token }, include: { organization: true, customer: { select: { phone: true } } } });
  // El turno tiene que ser de ESTE negocio y de quien responde: si no, se ignora sin decir nada.
  if (!appointment || appointment.organizationId !== organizationId) return;
  const organization: Organization = appointment.organization;
  const customerPhone = normalizePhone(appointment.customer.phone, organization.timezone);
  if (!customerPhone || customerPhone !== from) return;

  const when = formatDateTime(appointment.startsAt, organization.timezone);
  if (appointment.status !== "confirmed" || appointment.startsAt <= new Date()) {
    await sendSessionReply(organizationId, { to: from, appointmentId: appointment.id, text: "Este turno ya no se puede modificar por acá." });
    return;
  }

  if (action === "c") {
    if (!appointment.attendanceConfirmedAt) await db.appointment.update({ where: { id: appointment.id }, data: { attendanceConfirmedAt: new Date() } });
    await sendSessionReply(organizationId, { to: from, appointmentId: appointment.id, text: `¡Gracias! Dejamos confirmada tu asistencia: ${when}.` });
  } else if (action === "x") {
    // Cancelar pide un segundo paso: una pulsación accidental no cancela un turno.
    await sendSessionReply(organizationId, {
      to: from,
      appointmentId: appointment.id,
      text: `¿Seguro que querés cancelar tu turno del ${when}?`,
      buttons: [
        { id: `cx:${token}`, title: "Sí, cancelar" },
        { id: `ck:${token}`, title: "No, mantenerlo" },
      ],
    });
  } else if (action === "ck") {
    await sendSessionReply(organizationId, { to: from, appointmentId: appointment.id, text: `Perfecto, tu turno del ${when} sigue en pie.` });
  } else if (action === "cx") {
    const result = await cancelAppointment({ organization, appointmentId: appointment.id, actor: "customer" });
    await sendSessionReply(organizationId, {
      to: from,
      appointmentId: appointment.id,
      text: result.ok
        ? "Listo, cancelamos tu turno. Cuando quieras, podés reservar otro desde la página del negocio."
        : `${result.message}${organization.phone ? ` Podés comunicarte al ${organization.phone}.` : ""}`,
    });
  }
}
