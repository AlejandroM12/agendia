import "server-only";

import { randomUUID } from "node:crypto";
import type { NotificationType, Prisma } from "@prisma/client";

import { whatsappRows } from "@/modules/whatsapp/enqueue";
type Tx = Prisma.TransactionClient;

type AppointmentRef = {
  id: string;
  organizationId: string;
  professionalId: string;
  startsAt: Date;
};

type OrgNotificationSettings = {
  remindersEnabled: boolean;
  reminderHoursBefore: number;
  notifyOwnerOnBooking: boolean;
};

export type AppointmentEvent = "created" | "rescheduled" | "reassigned" | "canceled";

/**
 * Encola (outbox) las notificaciones de un cambio de turno, dentro de la
 * misma transacción que el cambio. Un proceso en segundo plano las envía
 * (modules/notifications/process.ts) — acá nunca se envía nada.
 *
 * - Cualquier notificación pendiente anterior del turno se cancela primero:
 *   así nunca sale un recordatorio de un turno cancelado o de un horario viejo.
 * - `actor` indica quién originó el cambio, para avisarle a la otra parte.
 */
export async function enqueueAppointmentNotifications(
  tx: Tx,
  params: {
    event: AppointmentEvent;
    actor: "professional" | "customer";
    /** Quién hizo el cambio en el panel (si fue alguien con sesión): no se le avisa a él mismo. */
    actorUserId?: string | null;
    appointment: AppointmentRef;
    customerEmail: string | null;
    settings: OrgNotificationSettings;
    /** Reprogramación que cambió al profesional: el aviso al cliente lo dice expresamente. */
    previousProfessionalId?: string;
    now?: Date;
  },
): Promise<void> {
  const { event, actor, appointment, customerEmail, settings } = params;
  const now = params.now ?? new Date();
  const revision = randomUUID();

  await tx.notification.updateMany({
    where: { appointmentId: appointment.id, status: "pending" },
    data: { status: "canceled" },
  });

  // Un turno cargado a posteriori (ya ocurrió) no genera avisos.
  if (appointment.startsAt.getTime() < now.getTime()) return;

  const rows: Prisma.NotificationCreateManyInput[] = [];
  const push = (type: NotificationType, recipient: string, scheduledFor: Date) =>
    rows.push({
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      type,
      recipient,
      scheduledFor,
      idempotencyKey: `${appointment.id}:${type}:${recipient}:${revision}`,
      ...(type === "reschedule" && params.previousProfessionalId
        ? { payload: { previousProfessionalId: params.previousProfessionalId } }
        : {}),
    });

  if (customerEmail) {
    if (event === "created") push("booking_confirmation", customerEmail, now);
    if (event === "rescheduled") push("reschedule", customerEmail, now);
    if (event === "reassigned") push("professional_change", customerEmail, now);
    if (event === "canceled") push("cancellation", customerEmail, now);

    if (event !== "canceled" && settings.remindersEnabled) {
      const remindAt = new Date(appointment.startsAt.getTime() - settings.reminderHoursBefore * 3600000);
      // Si el turno es tan próximo que el recordatorio ya "venció", la
      // confirmación que acaba de salir cumple esa función: no se duplica.
      if (remindAt.getTime() > now.getTime() + 15 * 60000) {
        push("reminder", customerEmail, remindAt);
      }
    }
  }

  // Una reasignación la decide el negocio: no hay a quién avisarle del lado del negocio.
  // Avisos internos: a quien corresponde, sin duplicados (ver resolveInternalRecipients).
  const internalType: NotificationType =
    event === "created" || event === "reassigned"
      ? "booking_received_owner"
      : event === "rescheduled"
        ? "reschedule_owner"
        : "cancellation_owner";
  for (const email of await resolveInternalRecipients(tx, {
    organizationId: appointment.organizationId,
    professionalId: appointment.professionalId,
    event,
    actor,
    actorUserId: params.actorUserId ?? null,
    notifyAdmins: settings.notifyOwnerOnBooking,
  })) {
    push(internalType, email, now);
  }

  // WhatsApp automático (solo con la integración activa y el consentimiento del destinatario).
  rows.push(...(await whatsappRows(tx, { event, appointment, revision, now, previousProfessionalId: params.previousProfessionalId })));

  if (rows.length) await tx.notification.createMany({ data: rows });
}

/**
 * A quién se le avisa de un turno DENTRO del negocio. Una sola regla:
 *
 * - **Propietario y administradores** (los avisos «de todo el negocio»): cuando
 *   un cliente reserva, reprograma o cancela por su cuenta, si el negocio tiene
 *   activos esos avisos y la persona no los desactivó. Los administradores
 *   empiezan sin ellos (se activan a propósito).
 * - **El profesional asignado**, si tiene cuenta vinculada y no desactivó sus avisos:
 *   de lo que le pasa a SUS turnos —sea el cliente o el negocio quien lo cambia— y
 *   cuando le asignan uno. No se le avisa de un cambio que hizo él mismo.
 * - **Nadie más**: los otros profesionales no reciben datos de turnos ajenos.
 * - Sin duplicados: si el propietario también es el profesional asignado, recibe uno solo.
 * - Un profesional sin cuenta no genera avisos propios: el negocio sigue funcionando como siempre.
 */
export async function resolveInternalRecipients(
  tx: Tx,
  params: {
    organizationId: string;
    professionalId: string;
    event: AppointmentEvent;
    actor: "professional" | "customer";
    actorUserId: string | null;
    notifyAdmins: boolean;
  },
): Promise<string[]> {
  // Una consulta por vez: una transacción interactiva tiene una sola conexión.
  const members = await tx.membership.findMany({
    where: { organizationId: params.organizationId },
    select: { userId: true, role: true, notifyBookings: true, user: { select: { email: true } } },
  });
  const professional = await tx.professional.findFirst({
    where: { id: params.professionalId, organizationId: params.organizationId },
    select: { userId: true },
  });

  const emails = new Map<string, string>();
  const add = (email: string) => emails.set(email.trim().toLowerCase(), email);

  if (params.actor === "customer" && params.event !== "reassigned" && params.notifyAdmins) {
    for (const member of members) {
      if ((member.role === "owner" || member.role === "admin") && member.notifyBookings) add(member.user.email);
    }
  }

  const assigned = professional?.userId ? members.find((m) => m.userId === professional.userId) : undefined;
  if (assigned && assigned.notifyBookings && assigned.userId !== params.actorUserId) add(assigned.user.email);

  return [...emails.values()];
}

