import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import {
  BookingSettingsForm,
  ExceptionForm,
  WeeklyHoursForm,
} from "@/components/availability/availability-forms";
import { CopyHoursForm } from "@/components/team/team-forms";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { isTeamModeEnabled } from "@/lib/features";
import { dateStrToDbDate, dbDateToDateStr, formatDateLong, minutesToLabel, todayInTz } from "@/lib/time";
import { cn } from "@/lib/utils";
import { listActiveProfessionals } from "@/modules/team/eligibility";
import { deleteBlockAction } from "@/modules/team/actions";

export const metadata: Metadata = { title: "Horarios" };

type BlockRow = {
  id: string;
  professionalId: string | null;
  date: Date;
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
};

function BlockList({ rows, canWrite }: { rows: BlockRow[]; canWrite: boolean }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mb-5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((exception) => (
        <li key={exception.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium first-letter:uppercase">{formatDateLong(dbDateToDateStr(exception.date))}</p>
            <p className="text-sm text-muted-foreground">
              {exception.startMinute === null || exception.endMinute === null
                ? "Todo el día"
                : `${minutesToLabel(exception.startMinute)} a ${minutesToLabel(exception.endMinute)}`}
              {exception.reason && ` · ${exception.reason}`}
            </p>
          </div>
          {canWrite && (
            <form action={deleteBlockAction.bind(null, exception.professionalId, exception.id)}>
              <button className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Quitar bloqueo">
                <X className="size-4" />
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function AvailabilityPage(props: PageProps<"/dashboard/disponibilidad">) {
  const { organization, canWrite } = await requireOrganization();
  const today = todayInTz(organization.timezone);
  const requested = (await props.searchParams).profesional;

  const active = await listActiveProfessionals(db, organization.id);
  // Con un solo profesional (o con el modo equipo apagado) la pantalla es la de siempre.
  const multi = isTeamModeEnabled(organization) && active.length > 1;
  const selected = (multi && typeof requested === "string" ? active.find((p) => p.id === requested) : null) ?? active[0] ?? null;

  const upcoming = { gte: dateStrToDbDate(today) };
  const order = [{ date: "asc" as const }, { startMinute: "asc" as const }];
  const [rules, general, individual] = await Promise.all([
    db.availabilityRule.findMany({
      where: { organizationId: organization.id, professionalId: selected?.id ?? null },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    // Los cierres generales (sin profesional) afectan a todos.
    db.availabilityException.findMany({
      where: { organizationId: organization.id, date: upcoming, professionalId: null },
      orderBy: order,
    }),
    selected
      ? db.availabilityException.findMany({
          where: { organizationId: organization.id, date: upcoming, professionalId: selected.id },
          orderBy: order,
        })
      : [],
  ]);
  // Con un solo profesional todos los bloqueos van juntos, como siempre.
  const singleRows = [...general, ...individual].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || (a.startMinute ?? -1) - (b.startMinute ?? -1),
  );

  return (
    <>
      <PageHeader
        title="Horarios"
        description={multi ? "Los horarios de cada profesional y los cierres de todo el negocio." : "Cuándo atendés y cómo se pueden reservar tus turnos."}
      />

      {multi && selected && (
        <nav aria-label="Profesional" className="mb-6 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {active.map((professional) => {
            const isSelected = professional.id === selected.id;
            return (
              <Link
                key={professional.id}
                href={`/dashboard/disponibilidad?profesional=${professional.id}`}
                aria-current={isSelected ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                  isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                )}
              >
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: professional.color }} />
                {professional.displayName}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="space-y-10">
        <Section
          title={multi && selected ? `Horario semanal de ${selected.displayName}` : "Horario semanal"}
          description={multi ? "Sus días y horarios de atención. Para un descanso, cargá dos franjas el mismo día." : "Tus días y horarios habituales."}
        >
          <WeeklyHoursForm key={selected?.id ?? "none"} rules={rules} disabled={!canWrite} professionalId={multi ? selected?.id : undefined} />
          {multi && selected && (
            <CopyHoursForm
              key={`copy-${selected.id}`}
              toProfessionalId={selected.id}
              options={active.filter((p) => p.id !== selected.id).map((p) => ({ id: p.id, displayName: p.displayName }))}
              disabled={!canWrite}
            />
          )}
        </Section>

        {multi && selected ? (
          <>
            <Section
              title={`Vacaciones y ausencias de ${selected.displayName}`}
              description={`Días u horarios en los que ${selected.displayName} no atiende. No afectan a los demás profesionales.`}
            >
              <BlockList rows={individual} canWrite={canWrite} />
              <ExceptionForm key={`block-${selected.id}`} minDate={today} disabled={!canWrite} professionalId={selected.id} />
            </Section>

            <Section title="Cierres de todo el negocio" description="Feriados o cierres en los que no atiende nadie. Afectan a todos los profesionales.">
              <BlockList rows={general} canWrite={canWrite} />
              <ExceptionForm key="general" minDate={today} disabled={!canWrite} />
            </Section>
          </>
        ) : (
          <Section title="Días y horarios bloqueados" description="Feriados, vacaciones o un rato puntual en el que no vas a atender.">
            <BlockList rows={singleRows} canWrite={canWrite} />
            <ExceptionForm minDate={today} disabled={!canWrite} />
          </Section>
        )}

        <Section title="Reglas de reserva online" description="Cómo se ofrecen los horarios en tu página pública.">
          <BookingSettingsForm settings={organization} disabled={!canWrite} />
        </Section>
      </div>
    </>
  );
}
