"use client";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { requestWhatsappActivationAction, updateMyWhatsappSettingsAction } from "@/modules/whatsapp/business-actions";

export function RequestActivationForm({ disabled }: { disabled?: boolean }) {
  const form = useForm(async (_prev, _formData) => requestWhatsappActivationAction(undefined));
  return (
    <form {...form.formProps} className="space-y-3">
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      <SubmitButton pending={form.pending} size="lg" pendingLabel="Enviando…" disabled={disabled || form.state?.ok}>
        Solicitar activación
      </SubmitButton>
    </form>
  );
}

export function WhatsappSettingsForm({
  settings,
  disabled,
}: {
  settings: { sendConfirmations: boolean; sendReminders: boolean; reminderHoursBefore: number; sendCancellations: boolean; sendReschedules: boolean };
  disabled?: boolean;
}) {
  const form = useForm(updateMyWhatsappSettingsAction);
  const items = [
    ["sendConfirmations", "Confirmación al reservar", settings.sendConfirmations],
    ["sendReminders", "Recordatorio antes del turno", settings.sendReminders],
    ["sendCancellations", "Aviso de cancelación", settings.sendCancellations],
    ["sendReschedules", "Aviso de reprogramación o cambio de profesional", settings.sendReschedules],
  ] as const;
  return (
    <form {...form.formProps} className="space-y-4">
      <fieldset disabled={disabled} className="space-y-3">
        <div className="space-y-2">
          {items.map(([name, label, checked]) => (
            <label key={name} className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-primary" /> {label}
            </label>
          ))}
        </div>
        <Field label="El recordatorio sale esta cantidad de horas antes" htmlFor="reminderHoursBefore" error={form.error("reminderHoursBefore")}>
          <Input id="reminderHoursBefore" name="reminderHoursBefore" type="number" min={1} max={168} defaultValue={settings.reminderHoursBefore} className="sm:max-w-32" />
        </Field>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending}>Guardar preferencias</SubmitButton>
      </fieldset>
    </form>
  );
}
