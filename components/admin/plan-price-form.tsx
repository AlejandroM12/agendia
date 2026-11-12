"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { updatePlanPriceAction } from "@/modules/admin/actions";

export function PlanPriceForm({ price, currency }: { price: number; currency: string }) {
  const [state, action] = useActionState(updatePlanPriceAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{currency}</span>
        <Input name="price" inputMode="numeric" defaultValue={price} aria-label="Precio mensual" className="max-w-40" required />
        <SubmitButton variant="outline">Guardar</SubmitButton>
      </div>
      <FormMessage message={state?.message} tone={state?.ok ? "success" : "error"} />
    </form>
  );
}
