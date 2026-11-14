"use client";

import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { type ActionState } from "@/lib/action-state";
import { formatDuration } from "@/lib/time";
import { DURATION_OPTIONS } from "@/modules/services/schema";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ServiceForm({
  action,
  service,
  submitLabel,
}: {
  action: Action;
  service?: { name: string; description: string | null; durationMinutes: number; price: number | null };
  submitLabel: string;
}) {
  const form = useForm(action);
  const durations = Array.from(new Set([...DURATION_OPTIONS, service?.durationMinutes ?? 30])).sort((a, b) => a - b);

  return (
    <form {...form.formProps} className="max-w-lg space-y-5">
      <FormMessage message={form.message} />
      <Field label="Nombre" htmlFor="name" error={form.error("name")}>
        <Input id="name" name="name" defaultValue={service?.name} maxLength={80} required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Duración" htmlFor="durationMinutes" error={form.error("durationMinutes")}>
          <select id="durationMinutes" name="durationMinutes" className="field" defaultValue={service?.durationMinutes ?? 30}>
            {durations.map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatDuration(minutes)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Precio" htmlFor="price" optional error={form.error("price")}>
          <Input id="price" name="price" inputMode="numeric" defaultValue={service?.price ?? ""} placeholder="Sin precio" />
        </Field>
      </div>
      <Field
        label="Descripción"
        htmlFor="description"
        optional
        hint="Se muestra en tu página de reservas."
        error={form.error("description")}
      >
        <textarea
          id="description"
          name="description"
          className="field h-auto min-h-20 py-2"
          maxLength={300}
          defaultValue={service?.description ?? ""}
        />
      </Field>
      <div className="flex gap-3 pt-1">
        <SubmitButton pending={form.pending}>{submitLabel}</SubmitButton>
        <ButtonLink variant="ghost" href="/dashboard/servicios">Cancelar</ButtonLink>
      </div>
    </form>
  );
}
