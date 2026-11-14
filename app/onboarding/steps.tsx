"use client";

import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { WeeklyHoursEditor } from "@/components/availability/weekly-hours-editor";
import { ServicesQuickEditor } from "@/components/services/services-quick-editor";
import { industries } from "@/lib/brand";
import { saveBusinessStep, saveHoursStep, saveServicesStep } from "./actions";

function StepFooter({ backHref, submitLabel, pending }: { backHref?: string; submitLabel: string; pending: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {backHref ? (
        <Link href={backHref} className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Volver
        </Link>
      ) : (
        <span />
      )}
      <SubmitButton pending={pending} size="lg">{submitLabel}</SubmitButton>
    </div>
  );
}

export function BusinessStep({ name, industry }: { name: string; industry: string | null }) {
  const form = useForm(saveBusinessStep);
  return (
    <form {...form.formProps} className="space-y-5">
      <FormMessage message={form.message} />
      <Field
        label="¿Cómo se llama tu negocio?"
        htmlFor="name"
        hint="Puede ser tu propio nombre. Es lo que van a ver tus clientes."
        error={form.error("name")}
      >
        <Input id="name" name="name" defaultValue={name} maxLength={80} required autoFocus />
      </Field>
      <Field label="¿A qué te dedicás?" htmlFor="industry" error={form.error("industry")}>
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
      <StepFooter pending={form.pending} submitLabel="Continuar" />
    </form>
  );
}

export function ServicesStep({
  initial,
}: {
  initial: Array<{ name: string; durationMinutes: number; price: number | null }>;
}) {
  const form = useForm(saveServicesStep);
  return (
    <form {...form.formProps} className="space-y-5">
      <FormMessage message={form.message} />
      <ServicesQuickEditor initial={initial} />
      <StepFooter pending={form.pending} backHref="/onboarding?paso=1" submitLabel="Continuar" />
    </form>
  );
}

export function HoursStep({
  initialRules,
}: {
  initialRules: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}) {
  const form = useForm(saveHoursStep);
  return (
    <form {...form.formProps} className="space-y-5">
      <FormMessage message={form.message} />
      <WeeklyHoursEditor initialRules={initialRules} />
      <StepFooter pending={form.pending} backHref="/onboarding?paso=2" submitLabel="Terminar y ver mi agenda" />
    </form>
  );
}
