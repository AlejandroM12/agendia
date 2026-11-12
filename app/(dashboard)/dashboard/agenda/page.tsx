import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { DateJump } from "@/components/appointments/date-jump";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
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
import { workingWindows } from "@/modules/availability/slots";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage(props: PageProps<"/dashboard/agenda">) {
  const { organization, canWrite } = await requireOrganization();
  const tz = organization.timezone;
  const now = new Date();
  const today = todayInTz(tz, now);

  const requested = (await props.searchParams).fecha;
  const date = isValidDateStr(requested) ? requested : today;

  const monday = addDays(date, -((weekdayOf(date) + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekStart = zonedTimeToUtc(monday, 0, tz);
  const weekEnd = zonedTimeToUtc(addDays(monday, 7), 0, tz);

  const [weekAppointments, rules, exceptions] = await Promise.all([
    db.appointment.findMany({
      where: { organizationId: organization.id, startsAt: { gte: weekStart, lt: weekEnd } },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        customer: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    db.availabilityRule.findMany({
      where: { organizationId: organization.id },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    db.availabilityException.findMany({
      where: { organizationId: organization.id, date: dateStrToDbDate(date) },
      select: { startMinute: true, endMinute: true, reason: true },
    }),
  ]);

  const byDay = new Map<string, typeof weekAppointments>();
  for (const appointment of weekAppointments) {
    const key = toZoned(appointment.startsAt, tz).dateStr;
    byDay.set(key, [...(byDay.get(key) ?? []), appointment]);
  }
  const dayAppointments = byDay.get(date) ?? [];
  const activeCount = (list: typeof weekAppointments) => list.filter((a) => a.status !== "canceled").length;

  const windows = workingWindows({ dateStr: date, rules, exceptions });
  const fullDayBlock = exceptions.find((e) => e.startMinute === null || e.endMinute === null);
  const hoursLabel = fullDayBlock
    ? `Día bloqueado${fullDayBlock.reason ? ` · ${fullDayBlock.reason}` : ""}`
    : windows.length === 0
      ? "No atendés este día"
      : `Atendés de ${windows.map((w) => `${minutesToLabel(w.startMinute)} a ${minutesToLabel(w.endMinute)}`).join(" y de ")}`;

  const newHref = `/dashboard/turnos/nuevo?fecha=${date}`;

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-highlight">{date === today ? "Hoy" : date === addDays(today, 1) ? "Mañana" : " "}</p>
          <h1 className="font-display text-2xl font-semibold first-letter:uppercase sm:text-3xl">{formatDateLong(date)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{hoursLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {date !== today && (
            <ButtonLink variant="outline" href="/dashboard/agenda">Hoy</ButtonLink>
          )}
          <DateJump value={date} />
          <ButtonLink
            variant="outline"
            size="icon"
            aria-label="Buscar turnos" href="/dashboard/turnos">
                <Search aria-hidden="true" />
              </ButtonLink>
        </div>
      </header>

      <nav aria-label="Semana" className="mb-6 flex items-stretch gap-1">
        <Link
          href={`/dashboard/agenda?fecha=${addDays(date, -7)}`}
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
                  href={`/dashboard/agenda?fecha=${day}`}
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
          href={`/dashboard/agenda?fecha=${addDays(date, 7)}`}
          aria-label="Semana siguiente"
          className="flex w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-5" />
        </Link>
      </nav>

      {dayAppointments.length === 0 ? (
        <EmptyState
          title="Sin turnos este día"
          description={
            windows.length === 0
              ? "No tenés horario de atención cargado para este día."
              : "Los turnos que agendes o que reserven tus clientes van a aparecer acá."
          }
          action={
            canWrite && (
              <ButtonLink href={newHref}>
                    <Plus aria-hidden="true" /> Agendar turno
                  </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <AppointmentList appointments={dayAppointments} timeZone={tz} now={date === today ? now : undefined} />
          {canWrite && (
            <ButtonLink
              variant="outline"
              className="mt-4 hidden lg:inline-flex" href={newHref}>
                  <Plus aria-hidden="true" /> Agendar otro turno
                </ButtonLink>
          )}
        </>
      )}
    </>
  );
}
