import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Mail, Phone, RotateCcw, UserX } from "lucide-react";
import {
  CancelAppointmentButton,
  NotesForm,
  ReassignForm,
  RescheduleForm,
} from "@/components/appointments/appointment-actions";
import { WhatsAppMenu } from "@/components/appointments/whatsapp-menu";
import { StatusBadge } from "@/components/appointments/status";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { isTeamModeEnabled } from "@/lib/features";
import { findAppointmentFor } from "@/modules/access/scope";
import { formatMoney } from "@/lib/brand";
import { formatDateLong, formatDuration, formatTime, toZoned } from "@/lib/time";
import { setOutcomeAction } from "@/modules/appointments/actions";
import { listActiveProfessionals } from "@/modules/team/eligibility";
import { getReassignOptions } from "@/modules/team/team-admin";
import { buildWhatsAppActions } from "@/modules/whatsapp/links";

export const metadata: Metadata = { title: "Turno" };

export default async function AppointmentPage(props: PageProps<"/dashboard/turnos/[id]">) {
  const context = await requireOrganization();
  const { organization, canWrite, permissions } = context;
  const restricted = context.restrictedProfessionalId !== null;
  const { id } = await props.params;
  const tz = organization.timezone;

  // Un identificador de turno no alcanza: un profesional solo accede a los suyos.
  const appointment = await findAppointmentFor(context, id, {
    customer: true,
    service: true,
    professional: { select: { id: true, displayName: true, color: true } },
  });
  if (!appointment) notFound();

  const { customer, service } = appointment;
  const dateStr = toZoned(appointment.startsAt, tz).dateStr;
  const duration = Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000);
  const started = appointment.startsAt <= new Date();
  // Con varios profesionales activos se muestra quién atiende y se puede reasignar.
  const multi = isTeamModeEnabled(organization) && (await listActiveProfessionals(db, organization.id)).length > 1;
  const upcoming = appointment.status === "confirmed" && appointment.startsAt > new Date();
  const canReassign = permissions.has("appointments.manage");
  const reassignOptions = multi && upcoming && canWrite && canReassign ? await getReassignOptions(organization, appointment.id) : [];
  // El teléfono y los enlaces de WhatsApp solo se arman si la persona tiene permiso sobre ESTE turno.
  const whatsapp = permissions.has("customers.contact") || (restricted && permissions.has("own.customers.contact"))
    ? buildWhatsAppActions({
        organization,
        appointment,
        customer,
        professionalName: multi ? appointment.professional.displayName : null,
      })
    : null;

  return (
    <>
      <PageHeader
        title={customer.name}
        back={{ href: `/dashboard/agenda?fecha=${dateStr}`, label: "Agenda" }}
        action={<StatusBadge status={appointment.status} className="px-3 py-1 text-sm" />}
      />

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="font-display text-2xl font-semibold first-letter:uppercase">{formatDateLong(dateStr)}</p>
        <p className="mt-1 text-lg tabular-nums">
          {formatTime(appointment.startsAt, tz)} a {formatTime(appointment.endsAt, tz)}
        </p>
        <p className="mt-3 text-muted-foreground">
          {service.name} · {formatDuration(duration)}
          {appointment.price !== null && ` · ${formatMoney(appointment.price)}`}
        </p>
        {multi && (
          <p className="mt-1 flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: appointment.professional.color }} />
            <span>
              Atiende <strong className="font-medium">{appointment.professional.displayName}</strong>
              {appointment.professionalSelection === "any" && <span className="text-muted-foreground"> (asignado automáticamente)</span>}
            </span>
          </p>
        )}
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
              {started && permissions.has(restricted ? "own.appointments.outcome" : "appointments.manage") && (
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
              {permissions.has(restricted ? "own.appointments.reschedule" : "appointments.manage") && (
                <RescheduleForm appointmentId={appointment.id} serviceId={service.id} defaultDate={dateStr} professionalId={multi || restricted ? appointment.professional.id : undefined} />
              )}
              {permissions.has(restricted ? "own.appointments.cancel" : "appointments.manage") && (
                <CancelAppointmentButton appointmentId={appointment.id} hasEmail={Boolean(customer.email)} />
              )}
            </>
          ) : (
            permissions.has(restricted ? "own.appointments.outcome" : "appointments.manage") && (
              <form action={setOutcomeAction.bind(null, appointment.id, "confirmed")}>
                <Button type="submit" variant="outline">
                  <RotateCcw aria-hidden="true" /> Deshacer
                </Button>
              </form>
            )
          )}
        </div>
      )}

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <Section title="Cliente">
          <div className="space-y-2">
            {(!restricted || permissions.has("own.customers.contact")) && (
              <Link href={`/dashboard/clientes/${customer.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {restricted ? "Ver cliente" : "Ver ficha e historial"}
              </Link>
            )}
            {customer.phone && (!restricted || permissions.has("own.customers.contact")) && (
              <div className="flex flex-wrap items-start gap-2 pt-1">
                <ButtonLink variant="outline" size="sm" href={`tel:${customer.phone}`}>
                  <Phone aria-hidden="true" /> {customer.phone}
                </ButtonLink>
                {whatsapp && <WhatsAppMenu actions={whatsapp} showDiscreet />}
              </div>
            )}
            {customer.email && !restricted && (
              <ButtonLink
                variant="outline"
                size="sm" href={`mailto:${customer.email}`}>
                    <Mail aria-hidden="true" /> {customer.email}
                  </ButtonLink>
            )}
            {!customer.phone && !customer.email && !restricted && (
              <p className="text-sm text-muted-foreground">Sin datos de contacto cargados.</p>
            )}
          </div>
        </Section>

        {reassignOptions.length > 0 || (multi && upcoming && canWrite && canReassign) ? (
          <Section title="Profesional" description="Pasá este turno a otro profesional, en el mismo día y horario.">
            <ReassignForm appointmentId={appointment.id} options={reassignOptions} />
          </Section>
        ) : null}

        {/* Las notas internas son del negocio: un profesional no las ve. */}
        {!restricted && (
          <Section title="Nota interna">
            <NotesForm appointmentId={appointment.id} notes={appointment.notes} disabled={!canWrite} />
          </Section>
        )}
      </div>
    </>
  );
}
