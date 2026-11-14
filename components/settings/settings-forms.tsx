"use client";

import { useEffect } from "react";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { PasswordField } from "@/components/form/password-field";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { firstFieldErrors } from "@/lib/action-state";
import { industries } from "@/lib/brand";
import { changePasswordSchema } from "@/modules/auth/schemas";
import {
  changePasswordAction,
  updateBusinessAction,
  updateRemindersAction,
} from "@/modules/organizations/settings-actions";

const TIMEZONES: Array<[string, string]> = [
  ["America/Argentina/Buenos_Aires", "Argentina (Buenos Aires)"],
  ["America/Montevideo", "Uruguay"],
  ["America/Santiago", "Chile"],
  ["America/Asuncion", "Paraguay"],
  ["America/La_Paz", "Bolivia"],
  ["America/Lima", "Perú"],
  ["America/Bogota", "Colombia"],
  ["America/Mexico_City", "México (Ciudad de México)"],
  ["Europe/Madrid", "España"],
];

export function BusinessForm({
  organization,
  disabled,
}: {
  organization: { industry: string | null; timezone: string };
  disabled: boolean;
}) {
  const form = useForm(updateBusinessAction);
  const timezones = TIMEZONES.some(([tz]) => tz === organization.timezone)
    ? TIMEZONES
    : [...TIMEZONES, [organization.timezone, organization.timezone] as [string, string]];

  return (
    <form {...form.formProps}>
      <fieldset disabled={disabled} className="max-w-lg space-y-5">
        <Field label="Actividad" htmlFor="industry" error={form.error("industry")}>
          <select id="industry" name="industry" className="field" defaultValue={organization.industry ?? "otro"}>
            {industries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Zona horaria"
          htmlFor="timezone"
          hint="Define a qué hora se ofrecen y se muestran los turnos."
          error={form.error("timezone")}
        >
          <select id="timezone" name="timezone" className="field" defaultValue={organization.timezone}>
            {timezones.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        {!disabled && <SubmitButton pending={form.pending}>Guardar cambios</SubmitButton>}
      </fieldset>
    </form>
  );
}

export function PasswordForm() {
  const form = useForm(changePasswordAction, {
    validate: (data) => {
      const parsed = changePasswordSchema.safeParse({ current: data.get("current"), next: data.get("next") });
      return parsed.success ? null : firstFieldErrors(parsed.error);
    },
  });

  // Navegación completa (no del router): descarta del navegador todo lo que
  // quedaba cargado de la sesión anterior.
  useEffect(() => {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (form.state?.ok) window.location.assign("/logout");
  }, [form.state]);

  return (
    <form {...form.formProps} className="max-w-lg space-y-5">
      <PasswordField
        id="current"
        name="current"
        label="Contraseña actual"
        autoComplete="current-password"
        error={form.error("current")}
      />
      <div>
        <PasswordField
          id="next"
          name="next"
          label="Contraseña nueva"
          autoComplete="new-password"
          showRules
          error={form.error("next")}
        />
        <p className="mt-2 text-sm text-muted-foreground">Al guardarla vas a tener que volver a ingresar.</p>
      </div>
      <FormMessage message={form.message} />
      <SubmitButton pending={form.pending} variant="outline">Cambiar contraseña</SubmitButton>
    </form>
  );
}

function Toggle({ name, label, description, defaultChecked }: { name: string; label: string; description: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-5 accent-[var(--primary)]" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export function RemindersForm({
  settings,
  disabled,
}: {
  settings: { remindersEnabled: boolean; reminderHoursBefore: number; notifyOwnerOnBooking: boolean };
  disabled: boolean;
}) {
  const form = useForm(updateRemindersAction);
  const options = Array.from(new Set([1, 2, 3, 6, 12, 24, 48, 72, settings.reminderHoursBefore])).sort((a, b) => a - b);

  return (
    <form {...form.formProps}>
      <fieldset disabled={disabled} className="max-w-lg space-y-4">
        <Toggle
          name="remindersEnabled"
          label="Recordarle el turno a mis clientes"
          description="Reciben un aviso antes del turno, con la opción de reprogramar o cancelar."
          defaultChecked={settings.remindersEnabled}
        />
        <Field label="Enviar el recordatorio" htmlFor="reminderHoursBefore" error={form.error("reminderHoursBefore")}>
          <select id="reminderHoursBefore" name="reminderHoursBefore" className="field sm:max-w-xs" defaultValue={settings.reminderHoursBefore}>
            {options.map((hours) => (
              <option key={hours} value={hours}>
                {hours < 24 ? `${hours} ${hours === 1 ? "hora" : "horas"} antes` : `${hours / 24} ${hours === 24 ? "día" : "días"} antes`}
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          name="notifyOwnerOnBooking"
          label="Avisarme cuando un cliente reserva o cancela"
          description="Te llega un email por cada reserva, cambio o cancelación hecha desde tu página."
          defaultChecked={settings.notifyOwnerOnBooking}
        />
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        {!disabled && <SubmitButton pending={form.pending}>Guardar preferencias</SubmitButton>}
      </fieldset>
    </form>
  );
}
