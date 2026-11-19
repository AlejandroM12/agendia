import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAttendance } from "@/components/booking/confirm-attendance";
import { ManageAppointment } from "@/components/booking/manage-appointment";
import { PublicShell } from "@/components/booking/public-shell";
import { StatusBadge } from "@/components/appointments/status";
import { ButtonLink } from "@/components/ui/button-link";
import { db } from "@/lib/db";
import { formatDateLong, formatDuration, formatTime, toZoned } from "@/lib/time";
import { getOrganizationImages } from "@/modules/public-page/images";
import { usesTeam } from "@/modules/team/eligibility";
import { toPublicProfile } from "@/modules/public-page/settings";

export const metadata: Metadata = {
  title: "Tu turno",
  robots: { index: false, follow: false },
  // El enlace es la credencial del turno: no debe viajar como referente.
  referrer: "no-referrer",
};
export const instant = false;

export default async function ManageAppointmentPage(props: PageProps<"/turno/[token]">) {
  const { token } = await props.params;
  if (token.length < 20 || token.length > 100) notFound();

  // El token opaco es la credencial: quien tiene el enlace gestiona el turno.
  const appointment = await db.appointment.findUnique({
    where: { manageToken: token },
    include: {
      organization: true,
      service: true,
      customer: { select: { name: true } },
      professional: { select: { displayName: true } },
    },
  });
  if (!appointment) notFound();

  const { organization } = appointment;
  const images = await getOrganizationImages(organization.id);
  // Solo se nombra al profesional en negocios con equipo: con uno solo, la pantalla es la de siempre.
  const showProfessional = await usesTeam(db, organization);
  const tz = organization.timezone;
  const dateStr = toZoned(appointment.startsAt, tz).dateStr;
  const duration = Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000);
  const now = new Date();
  const upcoming = appointment.status === "confirmed" && appointment.startsAt > now;
  const withinDeadline =
    appointment.startsAt.getTime() - now.getTime() >= organization.cancellationNoticeHours * 3600000;

  return (
    <PublicShell profile={toPublicProfile(organization)} images={images}>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">Turno de {appointment.customer.name}</p>
          <StatusBadge status={appointment.status} />
        </div>
        <p className="mt-2 font-display text-2xl font-semibold first-letter:uppercase">{formatDateLong(dateStr)}</p>
        <p className="mt-1 text-lg tabular-nums">{formatTime(appointment.startsAt, tz)} h</p>
        <p className="mt-3 text-muted-foreground">
          {appointment.service.name} · {formatDuration(duration)}
        </p>
        {showProfessional && (
          <p className="mt-1 text-muted-foreground">
            Te atiende <span className="font-medium text-foreground">{appointment.professional.displayName}</span>
          </p>
        )}
      </div>

      <div className="mt-6">
        {upcoming && (
          <div className="mb-4">
            <ConfirmAttendance token={token} confirmed={Boolean(appointment.attendanceConfirmedAt)} />
          </div>
        )}
        {upcoming && withinDeadline ? (
          <ManageAppointment
            token={token}
            professionalName={showProfessional ? appointment.professional.displayName : null}
            anyProfessional={showProfessional && appointment.professionalSelection === "any"}
          />
        ) : upcoming ? (
          <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
            Falta poco para tu turno, así que ya no se puede cambiar online.
            {organization.phone ? ` Comunicate al ${organization.phone}.` : " Comunicate con el negocio."}
          </p>
        ) : (
          <ButtonLink href={`/${organization.slug}`}>Reservar otro turno</ButtonLink>
        )}
      </div>

      <p className="mt-8 text-center text-sm">
        <Link href={`/${organization.slug}/mis-turnos`} className="font-medium text-brand-text underline-offset-4 hover:underline">
          Consultá todos tus turnos
        </Link>
      </p>
    </PublicShell>
  );
}
