import "server-only";

import { db } from "@/lib/db";

/**
 * Encola un recordatorio para enviarlo YA. Solo se usa desde la demostración («Enviar el recordatorio ahora»):
 * el procesador lo marca como simulado, así que nunca sale nada real. La clave es distinta en cada llamada para que
 * se pueda repetir y ver el efecto varias veces.
 */
export async function enqueueReminderNow(organizationId: string, appointmentId: string): Promise<void> {
  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, organizationId },
    select: { id: true, customer: { select: { email: true, phone: true } } },
  });
  if (!appointment) return;
  await db.notification.create({
    data: {
      organizationId,
      appointmentId: appointment.id,
      type: "reminder",
      channel: "email",
      recipient: appointment.customer.email ?? appointment.customer.phone ?? "cliente-demo",
      scheduledFor: new Date(),
      idempotencyKey: `demo-reminder:${appointment.id}:${Date.now()}`,
    },
  });
}
