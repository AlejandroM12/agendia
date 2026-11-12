"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { WeeklyHoursEditor } from "@/components/availability/weekly-hours-editor";
import { ServicesQuickEditor } from "@/components/services/services-quick-editor";
import { industries } from "@/lib/brand";
import { firstError } from "@/lib/action-state";
import { saveBusinessStep, saveHoursStep, saveServicesStep } from "./actions";

function StepFooter({ backHref, submitLabel }: { backHref?: string; submitLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {backHref ? (
        <Link href={backHref} className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Volver
        </Link>
      ) : (
        <span />
      )}
      <SubmitButton size="lg">{submitLabel}</SubmitButton>
    </div>
  );
}

export function BusinessStep({ name, industry }: { name: string; industry: string | null }) {
  const [state, action] = useActionState(saveBusinessStep, undefined);
  return (
    <form action={action} className="space-y-5">
      <FormMessage message={state?.message} />
      <Field
        label="¿Cómo se llama tu negocio?"
        htmlFor="name"
        hint="Puede ser tu propio nombre. Es lo que van a ver tus clientes."
        error={firstError(state, "name")}
      >
        <Input id="name" name="name" defaultValue={name} maxLength={80} required autoFocus />
      </Field>
      <Field label="¿A qué te dedicás?" htmlFor="industry" error={firstError(state, "industry")}>
        <select id="industry" name="industry" className="field" defaultValue={industry ?? ""} required>
          <option value="" disabled>
            Elegí una actividad
          </option>
          {industries.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <StepFooter submitLabel="Continuar" />
    </form>
  );
}

export function ServicesStep({
  initial,
}: {
  initial: Array<{ name: string; durationMinutes: number; price: number | null }>;
}) {
  const [state, action] = useActionState(saveServicesStep, undefined);
  return (
    <form action={action} className="space-y-5">
      <FormMessage message={state?.message} />
      <ServicesQuickEditor initial={initial} />
      <StepFooter backHref="/onboarding?paso=1" submitLabel="Continuar" />
    </form>
  );
}

export function HoursStep({
  initialRules,
}: {
  initialRules: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}) {
  const [state, action] = useActionState(saveHoursStep, undefined);
  return (
    <form action={action} className="space-y-5">
      <FormMessage message={state?.message} />
      <WeeklyHoursEditor initialRules={initialRules} />
      <StepFooter backHref="/onboarding?paso=2" submitLabel="Terminar y ver mi agenda" />
    </form>
  );
}
