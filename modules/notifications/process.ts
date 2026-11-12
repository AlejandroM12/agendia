import "server-only";

import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { isEmailConfigured, sendEmail } from "./email";
import { renderAppointmentEmail } from "./templates";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
/** Espera antes de cada reintento, según la cantidad de intentos ya hechos. */
const BACKOFF_MINUTES = [1, 5, 15, 60];

export type ProcessSummary = { claimed: number; sent: number; failed: number; retried: number; skipped: number; canceled: number };

/**
 * Envía las notificaciones pendientes cuya hora ya llegó.
 *
 * Es seguro ejecutarlo en paralelo o repetirlo: cada fila se reclama con
 * `FOR UPDATE SKIP LOCKED` + `lockedUntil`, de modo que dos ejecuciones
 * simultáneas nunca toman la misma notificación, y una fila ya enviada
 * (status = sent) no vuelve a salir.
 */
export async function processDueNotifications(limit = 25): Promise<ProcessSummary> {
  const summary: ProcessSummary = { claimed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, canceled: 0 };

  const claimed = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "notifications"
    SET "lockedUntil" = now() + make_interval(mins => ${LOCK_MINUTES}),
        "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "notifications"
      WHERE "status" = 'pending'
        AND "scheduledFor" <= now()
        AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
      ORDER BY "scheduledFor"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `;
  summary.claimed = claimed.length;

  for (const { id } of claimed) {
    const notification = await db.notification.findUnique({
      where: { id },
      include: {
        organization: true,
        appointment: { include: { service: true, customer: true } },
      },
    });
    if (!notification || notification.status !== "pending") continue;

    const { appointment, organization } = notification;

    // Un aviso que ya no corresponde no se envía: el turno desapareció, o
    // es un recordatorio/confirmación de un turno que ya fue cancelado.
    const obsolete =
      !appointment ||
      (appointment.status === "canceled" &&
        notification.type !== "cancellation" &&
        notification.type !== "cancellation_owner") ||
      (notification.type === "reminder" &&
        (appointment.status !== "confirmed" || appointment.startsAt <= new Date()));
    if (obsolete) {
      await db.notification.update({ where: { id }, data: { status: "canceled", lockedUntil: null } });
      summary.canceled++;
      continue;
    }

    if (notification.channel !== "email" || !isEmailConfigured()) {
      await db.notification.update({
        where: { id },
        data: {
          status: "skipped",
          lockedUntil: null,
          lastError:
            notification.channel === "email"
              ? "El envío de emails todavía no está configurado en esta instalación."
              : `El canal ${notification.channel} todavía no está disponible.`,
        },
      });
      summary.skipped++;
      continue;
    }

    const rendered = renderAppointmentEmail(notification.type, {
      organizationName: organization.name,
      organizationPhone: organization.phone,
      organizationAddress: organization.address,
      timezone: organization.timezone,
      customerName: appointment.customer.name,
      serviceName: appointment.service.name,
      durationMinutes: Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000),
      startsAt: appointment.startsAt,
      manageUrl: `${brand.url}/turno/${appointment.manageToken}`,
      dashboardUrl: `${brand.url}/dashboard/turnos/${appointment.id}`,
    });

    const result = await sendEmail({ to: notification.recipient, ...rendered });

    if (result.ok) {
      await db.notification.update({
        where: { id },
        data: { status: "sent", sentAt: new Date(), lastError: null, lockedUntil: null },
      });
      summary.sent++;
    } else if (notification.attempts >= MAX_ATTEMPTS) {
      await db.notification.update({
        where: { id },
        data: { status: "failed", lastError: result.error, lockedUntil: null },
      });
      summary.failed++;
    } else {
      const wait = BACKOFF_MINUTES[Math.min(notification.attempts - 1, BACKOFF_MINUTES.length - 1)];
      await db.notification.update({
        where: { id },
        data: {
          lastError: result.error,
          lockedUntil: null,
          scheduledFor: new Date(Date.now() + wait * 60000),
        },
      });
      summary.retried++;
    }
  }

  return summary;
}
