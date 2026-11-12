"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { type ActionState, firstError } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function CustomerForm({
  action,
  customer,
  submitLabel,
  disabled = false,
}: {
  action: Action;
  customer?: { name: string; email: string | null; phone: string | null; notes: string | null };
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction}>
      <fieldset disabled={disabled} className="max-w-lg space-y-5">
        <Field label="Nombre" htmlFor="name" error={firstError(state, "name")}>
          <Input id="name" name="name" defaultValue={customer?.name} maxLength={120} required />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Teléfono" htmlFor="phone" optional error={firstError(state, "phone")}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={customer?.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email" optional error={firstError(state, "email")}>
            <Input id="email" name="email" type="email" inputMode="email" defaultValue={customer?.email ?? ""} />
          </Field>
        </div>
        <Field label="Observaciones" htmlFor="notes" optional hint="Solo las ves vos.">
          <textarea
            id="notes"
            name="notes"
            className="field h-auto min-h-24 py-2"
            maxLength={2000}
            defaultValue={customer?.notes ?? ""}
          />
        </Field>
        <FormMessage message={state?.message} tone={state?.ok ? "success" : "error"} />
        {!disabled && <SubmitButton>{submitLabel}</SubmitButton>}
      </fieldset>
    </form>
  );
}
