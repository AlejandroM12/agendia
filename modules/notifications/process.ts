import "server-only";

import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { isTeamModeEnabled } from "@/lib/features";
import { usesTeam } from "@/modules/team/eligibility";
import { isEmailConfigured, sendEmail } from "./email";
import { renderAccountNotice } from "./account-notices";
import { renderAppointmentEmail } from "./templates";
import { DEMO_SIMULATED_NOTE, demoDelivery } from "@/modules/demo/policy";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
/** Espera antes de cada reintento, según la cantidad de intentos ya hechos. */
const BACKOFF_MINUTES = [1, 5, 15, 60];

/**
 * ¿Hay que decir quién atiende? Solo en negocios que usan equipos (modo
 * encendido y más de un profesional activo): con uno solo, los correos
 * quedan exactamente como siempre.
 */
const teamCache = new Map<string, { value: boolean; at: number }>();
async function showsProfessional(organization: { id: string; teamModeEnabled: boolean }): Promise<boolean> {
  if (!isTeamModeEnabled(organization)) return false;
  const cached = teamCache.get(organization.id);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = await usesTeam(db, organization);
  teamCache.set(organization.id, { value, at: Date.now() });
  return value;
}

/** Quién atendía antes, si este aviso de reprogramación lo registró (solo del mismo negocio). */
async function previousProfessionalName(notification: {
  type: string;
  organizationId: string;
  payload: unknown;
}): Promise<string | null> {
  if (notification.type !== "reschedule") return null;
  const id = (notification.payload as { previousProfessionalId?: unknown } | null)?.previousProfessionalId;
  if (typeof id !== "string") return null;
  const previous = await db.professional.findFirst({
    where: { id, organizationId: notification.organizationId },
    select: { displayName: true },
  });
  return previous?.displayName ?? null;
}

/**
 * Revalida, al enviar, a quién va un aviso interno: el negocio pudo revocar el
 * acceso, el profesional pudo desactivar sus avisos o el turno pudo pasar a otro.
 */
async function internalRecipientAllowed(
  notification: { organizationId: string; recipient: string },
  appointment: { professionalId: string },
): Promise<boolean> {
  const member = await db.membership.findFirst({
    where: { organizationId: notification.organizationId, user: { email: { equals: notification.recipient, mode: "insensitive" } } },
    select: { userId: true, role: true, notifyBookings: true },
  });
  if (!member || !member.notifyBookings) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  const assigned = await db.professional.findFirst({
    where: { id: appointment.professionalId, organizationId: notification.organizationId, userId: member.userId },
    select: { id: true },
  });
  return Boolean(assigned);
}

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
        appointment: { include: { service: true, customer: true, professional: { select: { displayName: true } } } },
      },
    });
    if (!notification || notification.status !== "pending") continue;

    const { appointment, organization } = notification;

    // Avisos de la cuenta (fin de la prueba, exceso de cupo): sin turno; solo al propietario vigente.
    if (notification.type === "account_notice") {
      const owner = await db.membership.findFirst({
        where: { organizationId: organization.id, role: "owner", user: { email: { equals: notification.recipient, mode: "insensitive" } } },
        select: { id: true },
      });
      const rendered = owner && notification.channel === "email" && isEmailConfigured() ? renderAccountNotice(notification, organization) : null;
      if (!owner || !rendered) {
        await db.notification.update({
          where: { id },
          data: { status: owner ? "skipped" : "canceled", lockedUntil: null, lastError: owner ? "Sin canal de email o aviso desconocido." : null },
        });
        summary[owner ? "skipped" : "canceled"]++;
        continue;
      }
      const sent = await sendEmail({ to: notification.recipient, ...rendered });
      if (sent.ok) {
        await db.notification.update({ where: { id }, data: { status: "sent", sentAt: new Date(), lastError: null, lockedUntil: null } });
        summary.sent++;
      } else if (notification.attempts >= MAX_ATTEMPTS) {
        await db.notification.update({ where: { id }, data: { status: "failed", lastError: sent.error, lockedUntil: null } });
        summary.failed++;
      } else {
        const wait = BACKOFF_MINUTES[Math.min(notification.attempts - 1, BACKOFF_MINUTES.length - 1)];
        await db.notification.update({
          where: { id },
          data: { lastError: sent.error, lockedUntil: null, scheduledFor: new Date(Date.now() + wait * 60000) },
        });
        summary.retried++;
      }
      continue;
    }

    // Un aviso que ya no corresponde no se envía: el turno desapareció, o
    // es un recordatorio/confirmación de un turno que ya fue cancelado.
    const obsolete =
      !appointment ||
      (appointment.status === "canceled" &&
        notification.type !== "cancellation" &&
        notification.type !== "cancellation_owner") ||
      (notification.type === "reminder" &&
        (appointment.status !== "confirmed" || appointment.startsAt <= new Date()));
    // Un aviso interno solo sale si hoy su destinatario sigue teniendo derecho a recibirlo
    // (membresía vigente y avisos activos, y —si es profesional— que el turno siga siendo suyo).
    const stillAllowed = obsolete || !notification.type.endsWith("_owner") || (await internalRecipientAllowed(notification, appointment));
    if (obsolete || !stillAllowed) {
      await db.notification.update({ where: { id }, data: { status: "canceled", lockedUntil: null } });
      summary.canceled++;
      continue;
    }

    // Una demo no envía nada real: el aviso se registra como simulado y se ve en la vista previa. Solo una demo
    // supervisada envía, y únicamente a los destinatarios autorizados expresamente.
    if (organization.isDemo && demoDelivery(organization, notification.recipient) === "simulate") {
      await db.notification.update({ where: { id }, data: { status: "sent", sentAt: new Date(), lastError: DEMO_SIMULATED_NOTE, lockedUntil: null } });
      summary.sent++;
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
      organizationColor: organization.themePrimary,
      professionalName: (await showsProfessional(organization)) ? appointment.professional.displayName : null,
      previousProfessionalName: await previousProfessionalName(notification),
    });

    // Los avisos al cliente salen con el nombre del negocio como remitente.
    const toCustomer = !notification.type.endsWith("_owner");
    const result = await sendEmail({
      to: notification.recipient,
      ...rendered,
      fromName: toCustomer ? organization.name : undefined,
    });

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
