import "server-only";

import type { NotificationType, Prisma } from "@prisma/client";
import { hasActiveConsent, normalizePhone } from "./consent";

type Tx = Prisma.TransactionClient;

type Event = "created" | "rescheduled" | "reassigned" | "canceled";

/**
 * Filas de WhatsApp del outbox para un cambio de turno. Se suman a las de correo dentro de la misma transacción
 * (modules/notifications/enqueue.ts) y las envía el mismo proceso (`modules/notifications/process.ts`), con los mismos
 * reintentos, bloqueos y claves de idempotencia. Solo se encola si el negocio tiene WhatsApp activo y conectado, el
 * aviso está habilitado en su configuración y el destinatario dio su consentimiento. Aquí nunca se envía nada.
 */
export async function whatsappRows(
  tx: Tx,
  params: { event: Event; appointment: { id: string; organizationId: string; startsAt: Date }; revision: string; now: Date; previousProfessionalId?: string },
): Promise<Prisma.NotificationCreateManyInput[]> {
  const { event, appointment, revision, now } = params;
  const connection = await tx.whatsappConnection.findUnique({ where: { organizationId: appointment.organizationId } });
  if (!connection || !connection.enabled || connection.status !== "connected" || !connection.credentials) return [];

  const organization = await tx.organization.findUnique({ where: { id: appointment.organizationId }, select: { timezone: true, isDemo: true, demoKind: true } });
  // La demo pública nunca envía por WhatsApp: se muestra en la vista previa. La supervisada sí (a los números autorizados).
  if (!organization || (organization.isDemo && organization.demoKind !== "supervised")) return [];

  const customer = await tx.appointment.findUnique({ where: { id: appointment.id }, select: { customer: { select: { phone: true } } } });
  const phone = normalizePhone(customer?.customer.phone, organization.timezone);
  if (!phone || !(await hasActiveConsent(tx, appointment.organizationId, phone))) return [];

  const rows: Prisma.NotificationCreateManyInput[] = [];
  const push = (type: NotificationType, scheduledFor: Date) =>
    rows.push({
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      type,
      channel: "whatsapp",
      recipient: phone,
      scheduledFor,
      idempotencyKey: `${appointment.id}:${type}:wa:${phone}:${revision}`,
      ...(type === "reschedule" && params.previousProfessionalId ? { payload: { previousProfessionalId: params.previousProfessionalId } } : {}),
    });

  if (event === "created" && connection.sendConfirmations) push("booking_confirmation", now);
  if (event === "rescheduled" && connection.sendReschedules) push("reschedule", now);
  if (event === "reassigned" && connection.sendReschedules) push("professional_change", now);
  if (event === "canceled" && connection.sendCancellations) push("cancellation", now);

  if (event !== "canceled" && connection.sendReminders) {
    const remindAt = new Date(appointment.startsAt.getTime() - connection.reminderHoursBefore * 3600000);
    // Si el turno es tan próximo que el recordatorio ya «venció», la confirmación cumple esa función: no se duplica.
    if (remindAt.getTime() > now.getTime() + 15 * 60000) push("reminder", remindAt);
  }
  return rows;
}
