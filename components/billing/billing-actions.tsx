"use client";

import { useActionState } from "react";
import { ConfirmButton } from "@/components/form/confirm-button";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { cancelSubscriptionAction, startSubscriptionAction } from "@/modules/billing/actions";

export function SubscribeButton({ label }: { label: string }) {
  const [state, action] = useActionState(startSubscriptionAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormMessage message={state?.message} />
      <SubmitButton size="lg" pendingLabel="Conectando con Mercado Pago…">
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
