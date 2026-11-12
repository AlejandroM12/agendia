import "server-only";

import { randomUUID } from "node:crypto";
import type { NotificationType, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

type AppointmentRef = {
  id: string;
  organizationId: string;
  startsAt: Date;
};

type OrgNotificationSettings = {
  remindersEnabled: boolean;
  reminderHoursBefore: number;
  notifyOwnerOnBooking: boolean;
};

export type AppointmentEvent = "created" | "rescheduled" | "canceled";

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
    appointment: AppointmentRef;
    customerEmail: string | null;
    settings: OrgNotificationSettings;
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

  const rows: Prisma.NotificationCreateManyInput[] = [];
  const push = (type: NotificationType, recipient: string, scheduledFor: Date) =>
    rows.push({
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      type,
      recipient,
      scheduledFor,
      idempotencyKey: `${appointment.id}:${type}:${recipient}:${revision}`,
    });

  if (customerEmail) {
    if (event === "created") push("booking_confirmation", customerEmail, now);
    if (event === "rescheduled") push("reschedule", customerEmail, now);
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

  if (actor === "customer" && settings.notifyOwnerOnBooking) {
    const owners = await tx.membership.findMany({
      where: { organizationId: appointment.organizationId },
      select: { user: { select: { email: true } } },
    });
    const ownerType: NotificationType =
      event === "created"
        ? "booking_received_owner"
        : event === "rescheduled"
          ? "reschedule_owner"
          : "cancellation_owner";
    for (const owner of owners) push(ownerType, owner.user.email, now);
  }

  if (rows.length) await tx.notification.createMany({ data: rows });
}
