"use client";

import { startDemoAction } from "@/modules/demo/actions";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";

/** Botón que abre una demostración nueva: un negocio ficticio solo para quien la pide. */
export function StartDemoForm({ label = "Probar la demo ahora" }: { label?: string }) {
  const form = useForm(async (_prev, _formData) => startDemoAction(undefined));
  return (
    <form {...form.formProps} className="space-y-3">
      <FormMessage message={form.message} />
      <SubmitButton pending={form.pending} size="lg" pendingLabel="Preparando tu demo…">
        {label}
      </SubmitButton>
    </form>
  );
}
