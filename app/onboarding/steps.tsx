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
import { saveBusinessStep, saveHoursStep, saveServicesStep, saveTeamStep } from "./actions";

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

export function BusinessStep({
  name,
  industry,
  askWorkMode = false,
  workMode = null,
}: {
  name: string;
  industry: string | null;
  askWorkMode?: boolean;
  workMode?: string | null;
}) {
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
      {askWorkMode && (
        <fieldset className="space-y-2" data-testid="work-mode">
          <legend className="text-sm font-medium">¿Cómo trabajás?</legend>
          {[
            { value: "solo", label: "Trabajo por mi cuenta", hint: "Una sola agenda. Es lo más rápido de configurar." },
            { value: "team", label: "Trabajo con otras personas", hint: "Cada profesional con su propia agenda." },
          ].map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-sm has-[:checked]:border-primary">
              <input type="radio" name="workMode" value={option.value} defaultChecked={(workMode ?? "solo") === option.value} className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <StepFooter pending={form.pending} submitLabel="Continuar" />
    </form>
  );
}

export function TeamStep({ trialLimit, teamLimit }: { trialLimit: number; teamLimit: number }) {
  const form = useForm(saveTeamStep);
  return (
    <form {...form.formProps} className="space-y-5" data-testid="team-step">
      <FormMessage message={form.message} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">¿Vos también atendés clientes?</legend>
        {[
          { value: "yes", label: "Sí, yo también atiendo" },
          { value: "no", label: "No, solo administro" },
        ].map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-sm has-[:checked]:border-primary">
            <input type="radio" name="ownerAttends" value={option.value} defaultChecked={option.value === "yes"} className="size-4 accent-primary" />
            {option.label}
          </label>
        ))}
      </fieldset>
      <Field
        label="¿Quiénes más atienden?"
        htmlFor="names"
        optional
        hint={`Un nombre por línea. En la prueba gratuita podés tener hasta ${trialLimit} profesionales activos; el Plan Equipo admite hasta ${teamLimit}. No hace falta invitar a nadie ahora.`}
      >
        <textarea id="names" name="names" rows={4} maxLength={600} className="field" placeholder={"Lucía\nMartín"} />
      </Field>
      <div className="flex items-center justify-between gap-3 pt-2">
        <Link href="/onboarding?paso=1" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Volver
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            name="skip"
            value="1"
            formNoValidate
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Completar más tarde
          </button>
          <SubmitButton pending={form.pending} size="lg">Continuar</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function ServicesStep({
  initial,
  backStep = 1,
}: {
  initial: Array<{ name: string; durationMinutes: number; price: number | null }>;
  backStep?: number;
}) {
  const form = useForm(saveServicesStep);
  return (
    <form {...form.formProps} className="space-y-5">
      <FormMessage message={form.message} />
      <ServicesQuickEditor initial={initial} />
      <StepFooter pending={form.pending} backHref={`/onboarding?paso=${backStep}`} submitLabel="Continuar" />
    </form>
  );
}

export function HoursStep({
  initialRules,
  backStep = 2,
}: {
  initialRules: Array<{ weekday: number; startMinute: number; endMinute: number }>;
  backStep?: number;
}) {
  const form = useForm(saveHoursStep);
  return (
    <form {...form.formProps} className="space-y-5">
      <FormMessage message={form.message} />
      <WeeklyHoursEditor initialRules={initialRules} />
      <StepFooter pending={form.pending} backHref={`/onboarding?paso=${backStep}`} submitLabel="Terminar y ver mi agenda" />
    </form>
  );
}
