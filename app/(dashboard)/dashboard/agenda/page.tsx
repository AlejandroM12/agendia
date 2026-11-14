import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { AppointmentList, type AppointmentListItem } from "@/components/appointments/appointment-list";
import { DateJump } from "@/components/appointments/date-jump";
import { ProfessionalAvatar } from "@/components/team/professional-avatar";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { isTeamModeEnabled } from "@/lib/features";
import {
  addDays,
  dateStrToDbDate,
  formatDateLong,
  isValidDateStr,
  minutesToLabel,
  todayInTz,
  toZoned,
  WEEKDAY_SHORT,
  weekdayOf,
  zonedTimeToUtc,
} from "@/lib/time";
import { cn } from "@/lib/utils";
import { listActiveProfessionals, schedulingProfessionalIds } from "@/modules/team/eligibility";
import { workingWindows } from "@/modules/availability/slots";

export const metadata: Metadata = { title: "Agenda" };

type Rule = { weekday: number; startMinute: number; endMinute: number; professionalId: string | null };
type Block = { professionalId: string | null; startMinute: number | null; endMinute: number | null; reason: string | null };

/** «Atiende de 09:00 a 13:00 y de 14:00 a 18:00», «No atiende este día», «Día bloqueado · feriado». */
function hoursLabel(date: string, rules: Rule[], blocks: Block[], who: string): string {
  const fullDay = blocks.find((b) => b.startMinute === null || b.endMinute === null);
  if (fullDay) return `Día bloqueado${fullDay.reason ? ` · ${fullDay.reason}` : ""}`;
  const windows = workingWindows({ dateStr: date, rules, exceptions: blocks });
  if (windows.length === 0) return `${who === "Atendés" ? "No atendés" : "No atiende"} este día`;
  return `${who} de ${windows.map((w) => `${minutesToLabel(w.startMinute)} a ${minutesToLabel(w.endMinute)}`).join(" y de ")}`;
}

/** Bloqueos de una parte del día, para mostrarlos como aviso («Bloqueado de 12:00 a 14:00 · trámite»). */
function partialBlocks(blocks: Block[]): string[] {
  return blocks
    .filter((b) => b.startMinute !== null && b.endMinute !== null)
    .map((b) => `Bloqueado de ${minutesToLabel(b.startMinute!)} a ${minutesToLabel(b.endMinute!)}${b.reason ? ` · ${b.reason}` : ""}`);
}

export default async function AgendaPage(props: PageProps<"/dashboard/agenda">) {
  const context = await requireOrganization();
  const { organization, canWrite, permissions } = context;
  const restricted = context.restrictedProfessionalId;
  const tz = organization.timezone;
  const now = new Date();
  const today = todayInTz(tz, now);

  const params = await props.searchParams;
  const date = isValidDateStr(params.fecha) ? params.fecha : today;

  const monday = addDays(date, -((weekdayOf(date) + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekStart = zonedTimeToUtc(monday, 0, tz);
  const weekEnd = zonedTimeToUtc(addDays(monday, 7), 0, tz);

  // Con un solo profesional (o con el modo equipo apagado) la agenda es la de siempre.
  const active = await listActiveProfessionals(db, organization.id);
  const teamMode = isTeamModeEnabled(organization) && active.length > 1;
  const requestedProfessional = typeof params.profesional === "string" ? params.profesional : "";
  // Un profesional ve SU agenda; la de un compañero solo como ocupación (sin datos de clientes) y si el negocio se lo permite.
  const viewTeam = restricted !== null && teamMode && permissions.has("team.availability.view");
  const colleague = viewTeam ? (active.find((p) => p.id === requestedProfessional && p.id !== restricted) ?? null) : null;
  const busyOnly = colleague !== null;
  const multi = restricted === null && teamMode;
  const filter = restricted !== null
    ? (colleague ?? active.find((p) => p.id === restricted) ?? null)
    : multi
      ? (active.find((p) => p.id === requestedProfessional) ?? null)
      : null;
  const targetId = restricted !== null ? (colleague?.id ?? restricted) : (filter?.id ?? null);
  const showChips = multi || viewTeam;

  const scheduleIds = restricted !== null ? [targetId!] : multi ? (filter ? [filter.id] : active.map((p) => p.id)) : await schedulingProfessionalIds(db, organization);
  const [weekAppointments, rules, exceptions] = await Promise.all([
    db.appointment.findMany({
      where: { organizationId: organization.id, startsAt: { gte: weekStart, lt: weekEnd }, ...(targetId ? { professionalId: targetId } : {}) },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        professionalId: true,
        customer: { select: { name: true } },
        service: { select: { name: true } },
        professional: { select: { id: true, displayName: true, color: true, active: true } },
      },
    }),
    db.availabilityRule.findMany({
      where: { organizationId: organization.id, professionalId: { in: scheduleIds } },
      select: { weekday: true, startMinute: true, endMinute: true, professionalId: true },
    }),
    db.availabilityException.findMany({
      where: { organizationId: organization.id, date: dateStrToDbDate(date) },
      select: { professionalId: true, startMinute: true, endMinute: true, reason: true },
    }),
  ]);

  const toItem = (a: (typeof weekAppointments)[number]): AppointmentListItem => ({
    id: a.id,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    customer: a.customer,
    service: a.service,
    professional: multi ? { displayName: a.professional.displayName, color: a.professional.color } : null,
  });

  const byDay = new Map<string, typeof weekAppointments>();
  for (const appointment of weekAppointments) {
    const key = toZoned(appointment.startsAt, tz).dateStr;
    byDay.set(key, [...(byDay.get(key) ?? []), appointment]);
  }
  const dayAppointments = byDay.get(date) ?? [];
  const activeCount = (list: typeof weekAppointments) => list.filter((a) => a.status !== "canceled").length;

  // Horario del día: del profesional filtrado, o el de siempre cuando hay uno solo.
  const blocksFor = (professionalId: string | null) => exceptions.filter((e) => e.professionalId === null || e.professionalId === professionalId);
  const singleId = targetId ?? filter?.id ?? scheduleIds[0] ?? null;
  const singleRules = rules.filter((r) => r.professionalId === singleId);
  const singleBlocks = multi || restricted !== null ? blocksFor(singleId) : exceptions;
  const headline = multi && !filter ? null : hoursLabel(date, singleRules, singleBlocks, multi || busyOnly ? "Atiende" : "Atendés");
  const singleWindows = workingWindows({ dateStr: date, rules: singleRules, exceptions: singleBlocks });

  // Una columna por profesional activo (y por quien tenga turnos ese día aunque ya esté desactivado).
  const columns = multi && !filter
    ? [
        ...active.map((p) => ({ id: p.id, name: p.displayName, color: p.color, photoImageId: p.photoImageId, inactive: false })),
        ...dayAppointments
          .filter((a) => !active.some((p) => p.id === a.professionalId))
          .map((a) => a.professional)
          .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
          .map((p) => ({ id: p.id, name: p.displayName, color: p.color, photoImageId: null, inactive: true })),
      ]
    : [];

  const query = (day: string) => `/dashboard/agenda?fecha=${day}${(multi || busyOnly) && filter ? `&profesional=${filter.id}` : ""}`;
  const canCreate = canWrite && !busyOnly && (permissions.has("appointments.manage") || permissions.has("own.appointments.create"));
  const newHref = `/dashboard/turnos/nuevo?fecha=${date}${filter && restricted === null ? `&profesional=${filter.id}` : ""}`;
  const showColumns = columns.length > 0;

  return (
    <div {...(showColumns ? { "data-wide-page": "" } : {})}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-highlight">{date === today ? "Hoy" : date === addDays(today, 1) ? "Mañana" : " "}</p>
          <h1 className="font-display text-2xl font-semibold first-letter:uppercase sm:text-3xl">{formatDateLong(date)}</h1>
          {headline && <p className="mt-1 text-sm text-muted-foreground">{headline}</p>}
        </div>
        <div className="flex items-center gap-2">
          {date !== today && <ButtonLink variant="outline" href={colleague ? `/dashboard/agenda?profesional=${colleague.id}` : filter && multi ? `/dashboard/agenda?profesional=${filter.id}` : "/dashboard/agenda"}>Hoy</ButtonLink>}
          <DateJump value={date} professionalId={multi || busyOnly ? filter?.id : undefined} />
          <ButtonLink variant="outline" size="icon" aria-label="Buscar turnos" href="/dashboard/turnos">
            <Search aria-hidden="true" />
          </ButtonLink>
        </div>
      </header>

      {showChips && (
        <nav aria-label="Profesional" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
          <Link
            href={`/dashboard/agenda?fecha=${date}`}
            aria-current={(restricted ? !busyOnly : !filter) ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              (restricted ? !busyOnly : !filter) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
            )}
          >
            {restricted ? "Mi agenda" : "Todo el equipo"}
          </Link>
          {active.filter((p) => p.id !== restricted).map((professional) => {
            const selected = filter?.id === professional.id;
            return (
              <Link
                key={professional.id}
                href={`/dashboard/agenda?fecha=${date}&profesional=${professional.id}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                )}
              >
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: professional.color }} />
                {professional.displayName}
              </Link>
            );
          })}
        </nav>
      )}

      <nav aria-label="Semana" className="mb-6 flex items-stretch gap-1">
        <Link
          href={query(addDays(date, -7))}
          aria-label="Semana anterior"
          className="flex w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <ol className="grid flex-1 grid-cols-7 gap-1">
          {weekDays.map((day) => {
            const count = activeCount(byDay.get(day) ?? []);
            const selected = day === date;
            return (
              <li key={day}>
                <Link
                  href={query(day)}
                  aria-current={selected ? "date" : undefined}
                  aria-label={`${formatDateLong(day)}, ${count} turnos`}
                  className={cn(
                    "flex flex-col items-center rounded-xl py-2 transition-colors",
                    selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    !selected && day === today && "ring-1 ring-highlight",
                  )}
                >
                  <span className={cn("text-[11px] font-medium uppercase", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {WEEKDAY_SHORT[weekdayOf(day)]}
                  </span>
                  <span className="text-lg leading-tight font-semibold tabular-nums">{Number(day.slice(8))}</span>
                  <span
                    className={cn(
                      "mt-0.5 h-1.5 w-1.5 rounded-full",
                      count === 0 ? "bg-transparent" : selected ? "bg-primary-foreground" : "bg-highlight",
                    )}
                  />
                </Link>
              </li>
            );
          })}
        </ol>
        <Link
          href={query(addDays(date, 7))}
          aria-label="Semana siguiente"
          className="flex w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-5" />
        </Link>
      </nav>

      {dayAppointments.length === 0 && !showColumns ? (
        <EmptyState
          title="Sin turnos este día"
          description={
            singleWindows.length === 0
              ? multi
                ? "Este profesional no tiene horario de atención este día."
                : "No tenés horario de atención cargado para este día."
              : "Los turnos que agendes o que reserven tus clientes van a aparecer acá."
          }
          action={
            canCreate && (
              <ButtonLink href={newHref}>
                <Plus aria-hidden="true" /> Agendar turno
              </ButtonLink>
            )
          }
        />
      ) : showColumns ? (
        <>
          {/* Escritorio: una columna por profesional. */}
          <div
            className="hidden gap-4 lg:grid"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
            data-testid="agenda-columns"
          >
            {columns.map((column) => {
              const appointments = dayAppointments.filter((a) => a.professionalId === column.id);
              const columnRules = rules.filter((r) => r.professionalId === column.id);
              const columnBlocks = blocksFor(column.id);
              const partial = partialBlocks(columnBlocks);
              return (
                <section key={column.id} aria-label={`Agenda de ${column.name}`} className="min-w-0">
                  <header className="mb-3 rounded-2xl border border-border bg-card p-3" style={{ borderTopColor: column.color, borderTopWidth: 4 }}>
                    <div className="flex items-center gap-2.5">
                      <ProfessionalAvatar name={column.name} color={column.color} photoImageId={column.photoImageId} className="size-9 text-sm" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{column.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {column.inactive ? "Desactivado" : `${activeCount(appointments)} ${activeCount(appointments) === 1 ? "turno" : "turnos"}`}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{hoursLabel(date, columnRules, columnBlocks, "Atiende")}</p>
                    {partial.map((text) => (
                      <p key={text} className="mt-1 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">{text}</p>
                    ))}
                  </header>
                  {appointments.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-input px-3 py-6 text-center text-sm text-muted-foreground">Sin turnos</p>
                  ) : (
                    <AppointmentList appointments={appointments.map(toItem)} timeZone={tz} now={date === today ? now : undefined} />
                  )}
                  {canWrite && !column.inactive && (
                    <ButtonLink variant="ghost" size="sm" className="mt-2 w-full" href={`/dashboard/turnos/nuevo?fecha=${date}&profesional=${column.id}`}>
                      <Plus aria-hidden="true" /> Agendar con {column.name}
                    </ButtonLink>
                  )}
                </section>
              );
            })}
          </div>

          {/* Celular y tablet: una sola lista con quién atiende cada turno; para ver a uno solo, el selector de arriba. */}
          <div className="lg:hidden">
            {dayAppointments.length === 0 ? (
              <EmptyState
                title="Sin turnos este día"
                description="Elegí un profesional arriba para ver su horario, o agendá un turno."
                action={canWrite && <ButtonLink href={newHref}><Plus aria-hidden="true" /> Agendar turno</ButtonLink>}
              />
            ) : (
              <AppointmentList appointments={dayAppointments.map(toItem)} timeZone={tz} now={date === today ? now : undefined} />
            )}
            {canWrite && dayAppointments.length > 0 && (
              <ButtonLink variant="outline" className="mt-4 hidden sm:inline-flex" href={newHref}>
                <Plus aria-hidden="true" /> Agendar otro turno
              </ButtonLink>
            )}
          </div>
        </>
      ) : (
        <>
          {multi && partialBlocks(singleBlocks).map((text) => (
            <p key={text} className="mb-3 rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">{text}</p>
          ))}
          {busyOnly ? (
            // Solo ocupación: horarios tomados, sin nombres, teléfonos ni servicios de los clientes del compañero.
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-label={`Horarios ocupados de ${colleague?.displayName}`}>
              {dayAppointments
                .filter((a) => a.status !== "canceled")
                .map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3.5">
                    <span className="w-24 shrink-0 font-semibold tabular-nums">
                      {minutesToLabel(toZoned(a.startsAt, tz).minutes)} – {minutesToLabel(toZoned(a.endsAt, tz).minutes)}
                    </span>
                    <span className="text-muted-foreground">Ocupado</span>
                  </li>
                ))}
            </ul>
          ) : (
            <AppointmentList appointments={dayAppointments.map(toItem)} timeZone={tz} now={date === today ? now : undefined} />
          )}
          {canCreate && (
            <ButtonLink variant="outline" className="mt-4 hidden lg:inline-flex" href={newHref}>
              <Plus aria-hidden="true" /> Agendar otro turno
            </ButtonLink>
          )}
        </>
      )}
    </div>
  );
}
