import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PublicShell } from "@/components/booking/public-shell";
import { ButtonLink } from "@/components/ui/button-link";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { formatDateLong, formatDuration, formatTime, toZoned } from "@/lib/time";
import { loadPublicOrganization } from "@/modules/public-page/load";
import { listUpcomingAppointments, resolveAccessToken } from "@/modules/public-page/lookup";
import { usesTeam } from "@/modules/team/eligibility";
import { db } from "@/lib/db";

export const instant = false;
export const metadata: Metadata = {
  title: { absolute: "Tus turnos" },
  robots: { index: false, follow: false },
  // El enlace es una credencial temporal: no debe viajar como referente.
  referrer: "no-referrer",
};

/**
 * Turnos próximos de un cliente en un negocio. Solo se llega con el enlace
 * temporal que se envió a su email; el token se valida contra **este**
 * negocio, así que un enlace emitido para otro no muestra nada.
 */
export default async function CustomerAppointmentsPage(props: PageProps<"/[slug]/mis-turnos/[token]">) {
  const { slug, token } = await props.params;
  // Un enlace viejo (alias) no reenvía el token: se pide uno nuevo en la dirección actual.
  const { organization, profile, images } = await loadPublicOrganization(slug, "/mis-turnos?enlace=vencido");

  const limited = !(await rateLimit(`lookup:open:${await clientIp()}`, 60, 3600)).allowed;
  const access = limited ? null : await resolveAccessToken(organization.id, token);
  if (!access) redirect(`/${profile.slug}/mis-turnos?enlace=vencido`);

  const appointments = await listUpcomingAppointments(organization.id, access.email);
  const tz = organization.timezone;
  const showProfessional = await usesTeam(db, organization);

  return (
    <PublicShell profile={profile} images={images}>
      <h1 className="font-display text-2xl font-semibold">Tus turnos</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Turnos próximos de <span className="font-medium break-all text-foreground">{access.email}</span> en {profile.name}.
      </p>

      {appointments.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-input bg-card/60 px-6 py-10 text-center">
          <p className="font-medium">No tenés turnos próximos</p>
          <p className="mt-1 text-sm text-muted-foreground">Cuando reserves uno, lo vas a ver acá.</p>
          <ButtonLink className="mt-5" href={`/${profile.slug}`}>Reservar un turno</ButtonLink>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {appointments.map((appointment) => {
            const duration = Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000);
            return (
              <li key={appointment.id}>
                <Link
                  href={`/turno/${appointment.manageToken}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-brand-border"
                >
                  <span className="min-w-0">
                    <span className="block font-medium first-letter:uppercase">
                      {formatDateLong(toZoned(appointment.startsAt, tz).dateStr)}, {formatTime(appointment.startsAt, tz)} h
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {appointment.service.name} · {formatDuration(duration)}
                      {showProfessional && ` · ${appointment.professional.displayName}`}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-brand-text">Ver, reprogramar o cancelar</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {appointments.length > 0 && (
        <p className="mt-8 text-center text-sm">
          <Link href={`/${profile.slug}`} className="font-medium text-brand-text underline-offset-4 hover:underline">
            Reservar otro turno
          </Link>
        </p>
      )}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Por seguridad, este enlace deja de funcionar una hora después de pedirlo.
      </p>
    </PublicShell>
  );
}
