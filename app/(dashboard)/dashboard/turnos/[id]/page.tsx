import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Mail, MessageCircle, Phone, RotateCcw, UserX } from "lucide-react";
import {
  CancelAppointmentButton,
  NotesForm,
  RescheduleForm,
} from "@/components/appointments/appointment-actions";
import { StatusBadge } from "@/components/appointments/status";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { formatMoney } from "@/lib/brand";
import { formatDateLong, formatDuration, formatTime, toZoned } from "@/lib/time";
import { setOutcomeAction } from "@/modules/appointments/actions";

export const metadata: Metadata = { title: "Turno" };

export default async function AppointmentPage(props: PageProps<"/dashboard/turnos/[id]">) {
  const { organization, canWrite } = await requireOrganization();
  const { id } = await props.params;
  const tz = organization.timezone;

  const appointment = await db.appointment.findFirst({
    where: { id, organizationId: organization.id },
    include: { customer: true, service: true },
  });
  if (!appointment) notFound();

  const { customer, service } = appointment;
  const dateStr = toZoned(appointment.startsAt, tz).dateStr;
  const duration = Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000);
  const started = appointment.startsAt <= new Date();
  const whatsapp = customer.phone
    ? `https://wa.me/${customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola ${customer.name}, te escribo de ${organization.name} por tu turno del ${formatDateLong(dateStr)} a las ${formatTime(appointment.startsAt, tz)}.`,
      )}`
    : null;

  return (
    <>
      <PageHeader
        title={customer.name}
        back={{ href: `/dashboard/agenda?fecha=${dateStr}`, label: "Agenda" }}
        action={<StatusBadge status={appointment.status} className="px-3 py-1 text-sm" />}
      />

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="font-display text-2xl font-semibold capitalize">{formatDateLong(dateStr)}</p>
        <p className="mt-1 text-lg tabular-nums">
          {formatTime(appointment.startsAt, tz)} a {formatTime(appointment.endsAt, tz)}
        </p>
        <p className="mt-3 text-muted-foreground">
          {service.name} · {formatDuration(duration)}
          {appointment.price !== null && ` · ${formatMoney(appointment.price)}`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {appointment.source === "public_booking" ? "Reservado online por el cliente" : "Agendado por vos"}
          {appointment.status === "canceled" &&
            ` · Cancelado por ${appointment.canceledBy === "customer" ? "el cliente" : "vos"}`}
        </p>
      </div>

      {canWrite && appointment.status !== "canceled" && (
        <div className="mt-4 flex flex-wrap gap-3">
          {appointment.status === "confirmed" ? (
            <>
              {started && (
                <>
                  <form action={setOutcomeAction.bind(null, appointment.id, "completed")}>
                    <Button type="submit">
                      <Check aria-hidden="true" /> Marcar completado
                    </Button>
                  </form>
                  <form action={setOutcomeAction.bind(null, appointment.id, "no_show")}>
                    <Button type="submit" variant="outline">
                      <UserX aria-hidden="true" /> No asistió
                    </Button>
                  </form>
                </>
              )}
              <RescheduleForm appointmentId={appointment.id} serviceId={service.id} defaultDate={dateStr} />
              <CancelAppointmentButton appointmentId={appointment.id} hasEmail={Boolean(customer.email)} />
            </>
          ) : (
            <form action={setOutcomeAction.bind(null, appointment.id, "confirmed")}>
              <Button type="submit" variant="outline">
                <RotateCcw aria-hidden="true" /> Deshacer
              </Button>
            </form>
          )}
        </div>
      )}

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <Section title="Cliente">
          <div className="space-y-2">
            <Link href={`/dashboard/clientes/${customer.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              Ver ficha e historial
            </Link>
            {customer.phone && (
              <div className="flex flex-wrap gap-2 pt-1">
                <ButtonLink
                  variant="outline"
                  size="sm" href={`tel:${customer.phone}`}>
                      <Phone aria-hidden="true" /> {customer.phone}
                    </ButtonLink>
                {whatsapp && (
                  <ButtonLink
                    variant="outline"
                    size="sm" href={whatsapp} target="_blank" rel="noopener noreferrer">
                        <MessageCircle aria-hidden="true" /> Escribir por WhatsApp
                      </ButtonLink>
                )}
              </div>
            )}
            {customer.email && (
              <ButtonLink
                variant="outline"
                size="sm" href={`mailto:${customer.email}`}>
                    <Mail aria-hidden="true" /> {customer.email}
                  </ButtonLink>
            )}
            {!customer.phone && !customer.email && (
              <p className="text-sm text-muted-foreground">Sin datos de contacto cargados.</p>
            )}
          </div>
        </Section>

        <Section title="Nota interna">
          <NotesForm appointmentId={appointment.id} notes={appointment.notes} disabled={!canWrite} />
        </Section>
      </div>
    </>
  );
}
