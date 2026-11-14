"use client";

import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { cancelSubscriptionAction, startSubscriptionAction } from "@/modules/billing/actions";

export function SubscribeButton({ label, defaultEmail }: { label: string; defaultEmail: string }) {
  const form = useForm(startSubscriptionAction);
  return (
    <form {...form.formProps} className="space-y-3">
      <Field
        label="Email de tu cuenta de Mercado Pago"
        htmlFor="payerEmail"
        hint="Tiene que ser el email con el que entrás a Mercado Pago para pagar."
        className="max-w-sm"
          error={form.error("payerEmail")}
        >
        <Input id="payerEmail" name="payerEmail" type="email" inputMode="email" defaultValue={defaultEmail} required />
      </Field>
      <FormMessage message={form.message} />
      <SubmitButton pending={form.pending} size="lg" pendingLabel="Conectando con Mercado Pago…">
        {label}
      </SubmitButton>
      <p className="text-xs text-muted-foreground">
        El pago se autoriza en Mercado Pago. Podés cancelar cuando quieras.
      </p>
    </form>
  );
}

export function CancelSubscriptionButton() {
  return (
    <ConfirmButton
      variant="outline"
      action={cancelSubscriptionAction}
      confirmMessage="¿Cancelar tu suscripción? Vas a conservar el acceso hasta el final del período ya pago."
    >
      Cancelar suscripción
    </ConfirmButton>
  );
}
