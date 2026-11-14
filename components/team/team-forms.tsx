"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import type { ActionState } from "@/lib/action-state";
import { PROFESSIONAL_COLORS } from "@/lib/team-colors";
import { cn } from "@/lib/utils";
import { copyHoursAction, saveProfessionalServicesAction } from "@/modules/team/actions";

function ColorPicker({ defaultValue, error }: { defaultValue: string; error: string | null }) {
  const [color, setColor] = useState(defaultValue);
  return (
    <Field label="Color" htmlFor="color" hint="Lo usamos para distinguirlo en la agenda." error={error}>
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Colores sugeridos" className="flex flex-wrap gap-2">
          {PROFESSIONAL_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={color.toLowerCase() === option}
              aria-label={`Color ${option}`}
              onClick={() => setColor(option)}
              style={{ backgroundColor: option }}
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background",
                color.toLowerCase() === option && "ring-2 ring-foreground",
              )}
            >
              {color.toLowerCase() === option && <Check className="size-4" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Elegir otro color"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#1f4d3f"}
            onChange={(event) => setColor(event.target.value)}
            className="size-10 shrink-0 cursor-pointer rounded-lg border border-input bg-card p-1"
          />
          <Input
            id="color"
            name="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            maxLength={7}
            autoCapitalize="none"
            spellCheck={false}
            className="w-32 font-mono"
          />
        </div>
      </div>
    </Field>
  );
}

type ProfessionalFormProps = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: { displayName: string; description: string | null; color: string; bookableOnline: boolean };
  /** Muestra «Soy yo» (solo al crear, y si todavía no hay un profesional vinculado a esta persona). */
  offerIsMe?: boolean;
  submitLabel: string;
  cancelHref?: string;
  disabled?: boolean;
  defaultColor: string;
};

export function ProfessionalForm({ action, initial, offerIsMe, submitLabel, cancelHref, disabled, defaultColor }: ProfessionalFormProps) {
  const form = useForm(action);
  return (
    <form {...form.formProps} className="max-w-lg">
      <fieldset disabled={disabled} className="space-y-5">
        <Field label="Nombre" htmlFor="displayName" hint="Como lo van a ver tus clientes." error={form.error("displayName")}>
          <Input id="displayName" name="displayName" required minLength={2} maxLength={80} defaultValue={initial?.displayName} placeholder="Lucas" autoComplete="off" />
        </Field>
        <Field label="Descripción" htmlFor="description" optional hint="Una línea sobre su especialidad." error={form.error("description")}>
          <Input id="description" name="description" maxLength={300} defaultValue={initial?.description ?? ""} placeholder="Cortes clásicos y barba" autoComplete="off" />
        </Field>
        <ColorPicker defaultValue={initial?.color ?? defaultColor} error={form.error("color")} />
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" name="bookableOnline" defaultChecked={initial?.bookableOnline ?? true} className="mt-0.5 size-5 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">Recibe reservas online</span>
            <span className="block text-muted-foreground">Si lo desmarcás, solo vos podés agendarle turnos desde la agenda.</span>
          </span>
        </label>
        {offerIsMe && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" name="isMe" className="mt-0.5 size-5 accent-[var(--primary)]" />
            <span>
              <span className="font-medium">Soy yo: yo también atiendo clientes</span>
              <span className="block text-muted-foreground">Sirve para identificar tu propia agenda dentro del equipo.</span>
            </span>
          </label>
        )}
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <div className="flex flex-wrap gap-3">
          <SubmitButton pending={form.pending} size="lg">{submitLabel}</SubmitButton>
          {cancelHref && <ButtonLink variant="ghost" size="lg" href={cancelHref}>Cancelar</ButtonLink>}
        </div>
      </fieldset>
    </form>
  );
}

export function ProfessionalServicesForm({
  professionalId,
  services,
  disabled,
}: {
  professionalId: string;
  services: Array<{ id: string; name: string; active: boolean; performs: boolean }>;
  disabled: boolean;
}) {
  const form = useForm(saveProfessionalServicesAction.bind(null, professionalId));
  if (services.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no cargaste servicios. Cuando los cargues, vas a poder elegir cuáles hace cada profesional.
      </p>
    );
  }
  return (
    <form {...form.formProps} className="max-w-lg">
      <fieldset disabled={disabled} className="space-y-4">
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {services.map((service) => (
            <li key={service.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm">
                <input type="checkbox" name="serviceId" value={service.id} defaultChecked={service.performs} className="size-5 accent-[var(--primary)]" />
                <span className="font-medium">{service.name}</span>
                {!service.active && <span className="text-xs text-muted-foreground">no se ofrece online</span>}
              </label>
            </li>
          ))}
        </ul>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending} variant="outline">Guardar servicios</SubmitButton>
      </fieldset>
    </form>
  );
}

/** «Copiar horarios de…»: reemplaza el horario semanal del profesional por el de otro. */
export function CopyHoursForm({
  toProfessionalId,
  options,
  disabled,
}: {
  toProfessionalId: string;
  options: Array<{ id: string; displayName: string }>;
  disabled: boolean;
}) {
  const form = useForm(copyHoursAction.bind(null, toProfessionalId));
  if (options.length === 0) return null;
  return (
    <form
      {...form.formProps}
      onSubmit={(event) => {
        if (!window.confirm("Los horarios actuales de este profesional se van a reemplazar por los del otro. ¿Seguimos?")) {
          event.preventDefault();
          return;
        }
        form.formProps.onSubmit(event);
      }}
      className="mt-4"
    >
      <fieldset disabled={disabled} className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Copiar los horarios de" htmlFor="fromProfessionalId" className="min-w-48 flex-1 sm:max-w-xs">
            <select id="fromProfessionalId" name="fromProfessionalId" className="field" defaultValue={options[0].id}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.displayName}</option>
              ))}
            </select>
          </Field>
          <SubmitButton pending={form.pending} variant="outline" pendingLabel="Copiando…">Copiar</SubmitButton>
        </div>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      </fieldset>
    </form>
  );
}
