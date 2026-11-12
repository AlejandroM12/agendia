import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { ShareLink } from "@/components/dashboard/share-link";
import { ButtonLink } from "@/components/ui/button-link";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { brand } from "@/lib/brand";
import { addDays, formatDateLong, formatTime, todayInTz, toZoned, zonedTimeToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Hoy" };

const appointmentSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  customer: { select: { name: true } },
  service: { select: { name: true } },
} as const;

export default async function TodayPage(props: PageProps<"/dashboard">) {
  const { organization, user, canWrite } = await requireOrganization();
  const tz = organization.timezone;
  const now = new Date();
  const today = todayInTz(tz, now);
  const dayStart = zonedTimeToUtc(today, 0, tz);
  const dayEnd = zonedTimeToUtc(addDays(today, 1), 0, tz);
  const welcome = (await props.searchParams).bienvenida === "1";

  const [todayAppointments, next, upcomingCount, activeServices] = await Promise.all([
    db.appointment.findMany({
      where: { organizationId: organization.id, startsAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startsAt: "asc" },
      select: appointmentSelect,
    }),
    db.appointment.findFirst({
      where: { organizationId: organization.id, status: "confirmed", endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      select: appointmentSelect,
    }),
    db.appointment.count({
      where: { organizationId: organization.id, status: "confirmed", startsAt: { gte: dayEnd } },
    }),
    db.service.count({ where: { organizationId: organization.id, active: true } }),
  ]);

  const hour = Math.floor(toZoned(now, tz).minutes / 60);
  const greeting = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const active = todayAppointments.filter((a) => a.status !== "canceled");
  const remaining = active.filter((a) => a.status === "confirmed" && a.endsAt > now).length;
  const publicUrl = `${brand.url}/${organization.slug}`;

  const nextDate = next ? toZoned(next.startsAt, tz).dateStr : null;
  const nextInProgress = next ? next.startsAt <= now : false;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-medium text-muted-foreground capitalize">{formatDateLong(today)}</p>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          {greeting}, {user.name.split(" ")[0]}
        </h1>
      </header>

      {welcome && (
        <div className="rounded-2xl bg-accent p-5">
          <p className="font-display text-xl font-semibold text-accent-foreground">Tu agenda está lista</p>
          <p className="mt-1 text-sm text-accent-foreground/85">
            Compartí tu enlace para empezar a recibir reservas, o agendá tu primer turno a mano.
          </p>
        </div>
      )}

      {activeServices === 0 && (
        <div className="rounded-2xl bg-warning-soft p-4 text-sm text-warning">
          No tenés servicios activos, así que tu página no puede recibir reservas.{" "}
          <Link href="/dashboard/servicios" className="font-semibold underline underline-offset-4">
            Revisar servicios
          </Link>
        </div>
      )}

      {next && (
        <section aria-labelledby="proximo">
          <h2 id="proximo" className="sr-only">
            Próximo turno
          </h2>
          <Link
            href={`/dashboard/turnos/${next.id}`}
            className="group flex items-center gap-5 rounded-2xl bg-primary p-5 text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <div className="text-center">
              <p className="font-display text-4xl leading-none font-semibold tabular-nums">{formatTime(next.startsAt, tz)}</p>
              <p className="mt-1.5 text-xs font-medium text-primary-foreground/75 uppercase">
                {nextInProgress ? "En curso" : nextDate === today ? "Hoy" : nextDate === addDays(today, 1) ? "Mañana" : formatDateLong(nextDate!).split(" ").slice(0, 2).join(" ")}
              </p>
            </div>
            <div className="h-12 w-px bg-primary-foreground/25" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-primary-foreground/75 uppercase">
                {nextInProgress ? "Turno actual" : "Próximo turno"}
              </p>
              <p className="truncate text-lg font-semibold">{next.customer.name}</p>
              <p className="truncate text-sm text-primary-foreground/85">{next.service.name}</p>
            </div>
            <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
        </section>
      )}

      <section aria-labelledby="hoy">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="hoy" className="text-lg font-semibold">
            Turnos de hoy
            {active.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {remaining > 0 ? `${remaining} por atender` : "todos atendidos"}
              </span>
            )}
          </h2>
          <Link href="/dashboard/agenda" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Ver agenda
          </Link>
        </div>
        {todayAppointments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-input bg-card/60 px-6 py-8 text-center">
            <p className="font-medium">Hoy no tenés turnos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {upcomingCount > 0
                ? `Tenés ${upcomingCount} ${upcomingCount === 1 ? "turno agendado" : "turnos agendados"} para los próximos días.`
                : "Compartí tu enlace de reservas o agendá uno a mano."}
            </p>
            {canWrite && (
              <ButtonLink
                className="mt-4" href={`/dashboard/turnos/nuevo?fecha=${today}`}>
                    <Plus aria-hidden="true" /> Agendar turno
                  </ButtonLink>
            )}
          </div>
        ) : (
          <AppointmentList appointments={todayAppointments} timeZone={tz} now={now} />
        )}
      </section>

      <ShareLink url={publicUrl} businessName={organization.name} />
    </div>
  );
}
