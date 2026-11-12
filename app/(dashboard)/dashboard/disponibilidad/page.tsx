import type { Metadata } from "next";
import { X } from "lucide-react";
import {
  BookingSettingsForm,
  ExceptionForm,
  WeeklyHoursForm,
} from "@/components/availability/availability-forms";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { dateStrToDbDate, dbDateToDateStr, formatDateLong, minutesToLabel, todayInTz } from "@/lib/time";
import { deleteExceptionAction } from "@/modules/availability/actions";

export const metadata: Metadata = { title: "Horarios" };

export default async function AvailabilityPage() {
  const { organization, canWrite } = await requireOrganization();
  const today = todayInTz(organization.timezone);

  const [rules, exceptions] = await Promise.all([
    db.availabilityRule.findMany({
      where: { organizationId: organization.id },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    db.availabilityException.findMany({
      where: { organizationId: organization.id, date: { gte: dateStrToDbDate(today) } },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    }),
  ]);

  return (
    <>
      <PageHeader title="Horarios" description="Cuándo atendés y cómo se pueden reservar tus turnos." />

      <div className="space-y-10">
        <Section title="Horario semanal" description="Tus días y horarios habituales.">
          <WeeklyHoursForm rules={rules} disabled={!canWrite} />
        </Section>

        <Section
          title="Días y horarios bloqueados"
          description="Feriados, vacaciones o un rato puntual en el que no vas a atender."
        >
          {exceptions.length > 0 && (
            <ul className="mb-5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {exceptions.map((exception) => (
                <li key={exception.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium capitalize">{formatDateLong(dbDateToDateStr(exception.date))}</p>
                    <p className="text-sm text-muted-foreground">
                      {exception.startMinute === null || exception.endMinute === null
                        ? "Todo el día"
                        : `${minutesToLabel(exception.startMinute)} a ${minutesToLabel(exception.endMinute)}`}
                      {exception.reason && ` · ${exception.reason}`}
                    </p>
                  </div>
                  {canWrite && (
                    <form action={deleteExceptionAction.bind(null, exception.id)}>
                      <button
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label="Quitar bloqueo"
                      >
                        <X className="size-4" />
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ExceptionForm minDate={today} disabled={!canWrite} />
        </Section>

        <Section title="Reglas de reserva online" description="Cómo se ofrecen los horarios en tu página pública.">
          <BookingSettingsForm settings={organization} disabled={!canWrite} />
        </Section>
      </div>
    </>
  );
}
