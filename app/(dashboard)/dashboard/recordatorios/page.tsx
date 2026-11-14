import type { Metadata } from "next";
import type { NotificationStatus, NotificationType } from "@prisma/client";
import { Mail, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { RemindersForm } from "@/components/settings/settings-forms";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/dal";
import { formatDateShort, formatTime, toZoned } from "@/lib/time";
import { cn } from "@/lib/utils";
import { isEmailConfigured } from "@/modules/notifications/email";

export const metadata: Metadata = { title: "Recordatorios" };

const TYPE_LABEL: Record<NotificationType, string> = {
  booking_confirmation: "Confirmación de turno",
  reminder: "Recordatorio",
  reschedule: "Aviso de cambio de horario",
  professional_change: "Aviso de cambio de profesional",
  cancellation: "Aviso de cancelación",
  booking_received_owner: "Aviso de nueva reserva (para vos)",
  cancellation_owner: "Aviso de cancelación (para vos)",
  reschedule_owner: "Aviso de cambio de horario (para vos)",
};

const STATUS: Record<NotificationStatus, { label: string; className: string }> = {
  pending: { label: "Programado", className: "bg-secondary text-muted-foreground" },
  sent: { label: "Enviado", className: "bg-success-soft text-success" },
  failed: { label: "Falló", className: "bg-danger-soft text-destructive" },
  canceled: { label: "Anulado", className: "bg-secondary text-muted-foreground" },
  skipped: { label: "No enviado", className: "bg-warning-soft text-warning" },
};

export default async function RemindersPage() {
  const { organization, canWrite } = await requirePagePermission("settings.manage");
  const tz = organization.timezone;
  const emailReady = isEmailConfigured();

  const notifications = await db.notification.findMany({
    where: { organizationId: organization.id },
    orderBy: { scheduledFor: "desc" },
    take: 40,
    include: { appointment: { select: { customer: { select: { name: true } } } } },
  });

  return (
    <>
      <PageHeader
        title="Recordatorios"
        description="Avisos automáticos para que tus clientes no se olviden del turno."
      />

      <div className="space-y-10">
        <Section title="Canales">
          <ul className="grid gap-3 sm:grid-cols-2">
            <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <Mail className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  Email{" "}
                  <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs font-medium", emailReady ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
                    {emailReady ? "Activo" : "Sin configurar"}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {emailReady
                    ? "Se envía a los clientes que dejan su email al reservar."
                    : "El envío de emails todavía no está habilitado en esta instalación: los avisos quedan registrados como «No enviado»."}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <MessageCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  WhatsApp, a mano{" "}
                  <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">Lo enviás vos</span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Desde cada turno podés abrir WhatsApp con el mensaje ya escrito (confirmación, recordatorio, cambio o cancelación), revisarlo y enviarlo desde tu propio WhatsApp. No sale solo.
                </p>
              </div>
            </li>
          </ul>
        </Section>

        <Section title="Preferencias">
          <RemindersForm settings={organization} disabled={!canWrite} />
        </Section>

        <Section title="Últimos avisos">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay avisos. Aparecen cuando un turno tiene un cliente con email.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {notifications.map((notification) => {
                const when = toZoned(notification.sentAt ?? notification.scheduledFor, tz);
                const status = STATUS[notification.status];
                return (
                  <li key={notification.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {TYPE_LABEL[notification.type]}
                        {notification.appointment && ` · ${notification.appointment.customer.name}`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDateShort(when.dateStr)}, {formatTime(notification.sentAt ?? notification.scheduledFor, tz)} ·{" "}
                        {notification.recipient}
                        {notification.status === "failed" && notification.lastError ? ` · ${notification.lastError}` : ""}
                      </p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", status.className)}>
                      {status.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
