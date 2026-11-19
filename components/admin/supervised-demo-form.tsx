"use client";

import { createSupervisedDemoAction } from "@/modules/admin/actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";

export function SupervisedDemoForm() {
  const form = useForm(createSupervisedDemoAction);
  return (
    <form {...form.formProps} className="max-w-xl space-y-3">
      <Field label="Correos autorizados a recibir avisos reales" htmlFor="recipients" hint="De 1 a 5, separados por coma. Típicamente el tuyo y el de quien recibe la demostración." error={form.error("recipients")}>
        <Input id="recipients" name="recipients" autoComplete="off" required />
      </Field>
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      <SubmitButton pending={form.pending}>Crear demo supervisada</SubmitButton>
    </form>
  );
}
