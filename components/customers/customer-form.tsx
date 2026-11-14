"use client";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { type ActionState, firstFieldErrors } from "@/lib/action-state";
import { customerInputSchema } from "@/modules/customers/schema";

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
  const form = useForm(action, {
    // El mismo esquema con el que valida el servidor.
    validate: (data) => {
      const parsed = customerInputSchema.safeParse(Object.fromEntries(data));
      return parsed.success ? null : firstFieldErrors(parsed.error);
    },
  });

  return (
    <form {...form.formProps}>
      <fieldset disabled={disabled} className="max-w-lg space-y-5">
        <Field label="Nombre" htmlFor="name" error={form.error("name")}>
          <Input id="name" name="name" defaultValue={customer?.name} maxLength={120} required />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Teléfono" htmlFor="phone" optional error={form.error("phone")}>
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={customer?.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email" optional error={form.error("email")}>
            <Input id="email" name="email" type="email" inputMode="email" defaultValue={customer?.email ?? ""} />
          </Field>
        </div>
        <Field label="Observaciones" htmlFor="notes" optional hint="Solo las ves vos." error={form.error("notes")}>
          <textarea
            id="notes"
            name="notes"
            className="field h-auto min-h-24 py-2"
            maxLength={2000}
            defaultValue={customer?.notes ?? ""}
          />
        </Field>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        {!disabled && <SubmitButton pending={form.pending}>{submitLabel}</SubmitButton>}
      </fieldset>
    </form>
  );
}
