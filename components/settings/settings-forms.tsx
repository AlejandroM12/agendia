"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { industries } from "@/lib/brand";
import { firstError } from "@/lib/action-state";
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
  baseUrl,
  disabled,
}: {
  organization: {
    name: string;
    industry: string | null;
    description: string | null;
    phone: string | null;
    address: string | null;
    timezone: string;
    slug: string;
  };
  baseUrl: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(updateBusinessAction, undefined);
  const timezones = TIMEZONES.some(([tz]) => tz === organization.timezone)
    ? TIMEZONES
    : [...TIMEZONES, [organization.timezone, organization.timezone] as [string, string]];

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="max-w-lg space-y-5">
        <Field label="Nombre del negocio" htmlFor="name" error={firstError(state, "name")}>
          <Input id="name" name="name" defaultValue={organization.name} maxLength={80} required />
        </Field>
        <Field label="Actividad" htmlFor="industry" error={firstError(state, "industry")}>
          <select id="industry" name="industry" className="field" defaultValue={organization.industry ?? "otro"}>
            {industries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Descripción breve"
          htmlFor="description"
          optional
          hint="Aparece debajo del nombre en tu página de reservas."
          error={firstError(state, "description")}
        >
          <Input id="description" name="description" defaultValue={organization.description ?? ""} maxLength={160} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Teléfono de contacto" htmlFor="phone" optional>
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={organization.phone ?? ""} maxLength={40} />
          </Field>
          <Field label="Dirección" htmlFor="address" optional>
            <Input id="address" name="address" defaultValue={organization.address ?? ""} maxLength={160} />
          </Field>
        </div>
        <Field
          label="Enlace de reservas"
          htmlFor="slug"
          hint="Si lo cambiás, el enlace anterior deja de funcionar."
          error={firstError(state, "slug")}
        >
          <div className="flex items-center rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
            <span className="shrink-0 pl-3 text-sm text-muted-foreground">{baseUrl.replace(/^https?:\/\//, "")}/</span>
            <input
              id="slug"
              name="slug"
              defaultValue={organization.slug}
              className="h-10 min-w-0 flex-1 bg-transparent pr-3 outline-none"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={50}
              required
            />
          </div>
        </Field>
        <Field label="Zona horaria" htmlFor="timezone" error={firstError(state, "timezone")}>
          <select id="timezone" name="timezone" className="field" defaultValue={organization.timezone}>
            {timezones.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <FormMessage message={state?.message} tone={state?.ok ? "success" : "error"} />
        {!disabled && <SubmitButton>Guardar cambios</SubmitButton>}
      </fieldset>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="max-w-lg space-y-5">
      <Field label="Contraseña actual" htmlFor="current" error={firstError(state, "current")}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field
        label="Contraseña nueva"
        htmlFor="next"
        hint="Al guardarla vas a tener que volver a ingresar."
        error={firstError(state, "next")}
      >
        <Input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <FormMessage message={state?.message} />
      <SubmitButton variant="outline">Cambiar contraseña</SubmitButton>
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
  const [state, action] = useActionState(updateRemindersAction, undefined);
  const options = Array.from(new Set([1, 2, 3, 6, 12, 24, 48, 72, settings.reminderHoursBefore])).sort((a, b) => a - b);

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="max-w-lg space-y-4">
        <Toggle
          name="remindersEnabled"
          label="Recordarle el turno a mis clientes"
          description="Reciben un aviso antes del turno, con la opción de reprogramar o cancelar."
          defaultChecked={settings.remindersEnabled}
        />
        <Field label="Enviar el recordatorio" htmlFor="reminderHoursBefore">
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
        <FormMessage message={state?.message} tone={state?.ok ? "success" : "error"} />
        {!disabled && <SubmitButton>Guardar preferencias</SubmitButton>}
      </fieldset>
    </form>
  );
}
