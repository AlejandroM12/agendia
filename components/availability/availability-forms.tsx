"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { saveBookingSettingsAction, saveWeeklyHoursAction } from "@/modules/availability/actions";
import { addBlockAction, saveProfessionalHoursAction } from "@/modules/team/actions";
import { WeeklyHoursEditor } from "./weekly-hours-editor";

type Rule = { weekday: number; startMinute: number; endMinute: number };

/** Con `professionalId` guarda el horario de ese profesional; sin él, el del profesional «de siempre». */
export function WeeklyHoursForm({ rules, disabled, professionalId }: { rules: Rule[]; disabled: boolean; professionalId?: string }) {
  const form = useForm(professionalId ? saveProfessionalHoursAction.bind(null, professionalId) : saveWeeklyHoursAction);
  return (
    <form {...form.formProps} className="space-y-4">
      <fieldset disabled={disabled} className="space-y-4">
        <WeeklyHoursEditor initialRules={rules} />
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending}>Guardar horarios</SubmitButton>
      </fieldset>
    </form>
  );
}

const NOTICE_OPTIONS: Array<[number, string]> = [
  [0, "Sin anticipación"],
  [60, "1 hora antes"],
  [120, "2 horas antes"],
  [240, "4 horas antes"],
  [720, "12 horas antes"],
  [1440, "1 día antes"],
  [2880, "2 días antes"],
];

const withCurrent = (options: Array<[number, string]>, current: number, label: (v: number) => string) =>
  options.some(([value]) => value === current)
    ? options
    : [...options, [current, label(current)] as [number, string]].sort((a, b) => a[0] - b[0]);

export function BookingSettingsForm({
  settings,
  disabled,
}: {
  settings: {
    slotIntervalMinutes: number;
    bufferMinutes: number;
    minNoticeMinutes: number;
    maxAdvanceDays: number;
    cancellationNoticeHours: number;
  };
  disabled: boolean;
}) {
  const form = useForm(saveBookingSettingsAction);
  return (
    <form {...form.formProps}>
      <fieldset disabled={disabled} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Ofrecer horarios cada" htmlFor="slotIntervalMinutes" error={form.error("slotIntervalMinutes")}>
            <select id="slotIntervalMinutes" name="slotIntervalMinutes" className="field" defaultValue={settings.slotIntervalMinutes}>
              {[10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutos
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descanso entre turnos" htmlFor="bufferMinutes" error={form.error("bufferMinutes")}>
            <select id="bufferMinutes" name="bufferMinutes" className="field" defaultValue={settings.bufferMinutes}>
              {withCurrent([[0, "Sin descanso"], [5, "5 minutos"], [10, "10 minutos"], [15, "15 minutos"], [30, "30 minutos"]], settings.bufferMinutes, (v) => `${v} minutos`).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Se puede reservar hasta" htmlFor="minNoticeMinutes" hint="Evita reservas de último momento." error={form.error("minNoticeMinutes")}>
            <select id="minNoticeMinutes" name="minNoticeMinutes" className="field" defaultValue={settings.minNoticeMinutes}>
              {withCurrent(NOTICE_OPTIONS, settings.minNoticeMinutes, (v) => `${Math.round(v / 60)} horas antes`).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Agenda abierta para los próximos" htmlFor="maxAdvanceDays" error={form.error("maxAdvanceDays")}>
            <select id="maxAdvanceDays" name="maxAdvanceDays" className="field" defaultValue={settings.maxAdvanceDays}>
              {withCurrent([[7, "7 días"], [14, "14 días"], [30, "30 días"], [60, "60 días"], [90, "90 días"], [180, "6 meses"]], settings.maxAdvanceDays, (v) => `${v} días`).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Tus clientes pueden cancelar o reprogramar hasta"
            htmlFor="cancellationNoticeHours"
            className="sm:col-span-2"
          error={form.error("cancellationNoticeHours")}
        >
            <select id="cancellationNoticeHours" name="cancellationNoticeHours" className="field sm:max-w-xs" defaultValue={settings.cancellationNoticeHours}>
              {withCurrent([[0, "El momento del turno"], [1, "1 hora antes"], [2, "2 horas antes"], [6, "6 horas antes"], [12, "12 horas antes"], [24, "24 horas antes"], [48, "48 horas antes"]], settings.cancellationNoticeHours, (v) => `${v} horas antes`).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending}>Guardar reglas</SubmitButton>
      </fieldset>
    </form>
  );
}

/**
 * Agrega un bloqueo: un día (entero o un rato) o varios días seguidos
 * (vacaciones, licencia). Con `professionalId` es individual; sin él, un
 * cierre general del negocio que afecta a todos.
 */
export function ExceptionForm({
  minDate,
  disabled,
  professionalId = null,
}: {
  minDate: string;
  disabled: boolean;
  professionalId?: string | null;
}) {
  const form = useForm(addBlockAction.bind(null, professionalId));
  const [fullDay, setFullDay] = useState(true);
  const [until, setUntil] = useState("");

  return (
    <form {...form.formProps}>
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha" htmlFor="date" error={form.error("date")}>
            <Input id="date" name="date" type="date" min={minDate} required />
          </Field>
          <Field label="Hasta" htmlFor="until" optional hint="Para bloquear varios días seguidos, como vacaciones." error={form.error("until")}>
            <Input id="until" name="until" type="date" min={minDate} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <Field label="Motivo" htmlFor="reason" optional error={form.error("reason")} className="sm:col-span-2">
            <Input id="reason" name="reason" maxLength={120} placeholder="Feriado, vacaciones, trámite…" />
          </Field>
        </div>
        {!until && (
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              name="fullDay"
              className="size-5 accent-[var(--primary)]"
              checked={fullDay}
              onChange={(e) => setFullDay(e.target.checked)}
            />
            Todo el día
          </label>
        )}
        {!until && !fullDay && (
          <div className="flex items-center gap-2">
            <input type="time" name="start" aria-label="Desde" className="field w-auto" defaultValue="12:00" required />
            <span className="text-sm text-muted-foreground">a</span>
            <input type="time" name="end" aria-label="Hasta" className="field w-auto" defaultValue="14:00" required />
          </div>
        )}
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending} variant="outline">Agregar bloqueo</SubmitButton>
      </fieldset>
    </form>
  );
}
