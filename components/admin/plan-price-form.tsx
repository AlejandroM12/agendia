"use client";

import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { updatePlanPriceAction } from "@/modules/admin/actions";

export function PlanPriceForm({ price, currency }: { price: number; currency: string }) {
  const form = useForm(updatePlanPriceAction);
  return (
    <form {...form.formProps} className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{currency}</span>
        <Input name="price" inputMode="numeric" defaultValue={price} aria-label="Precio mensual" className="max-w-40" required />
        <SubmitButton pending={form.pending} variant="outline">Guardar</SubmitButton>
      </div>
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
    </form>
  );
}
