"use client";

import { ConfirmButton } from "@/components/form/confirm-button";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { cancelSubscriptionAction, discardPlanChangeAction, refreshPaymentStatusAction } from "@/modules/billing/actions";

/** «Ya pagué»: consulta a Mercado Pago ahora, sin esperar al aviso ni a la revisión automática. */
export function RefreshPaymentButton() {
  const form = useForm(async () => refreshPaymentStatusAction());
  return (
    <form {...form.formProps} className="space-y-2">
      <SubmitButton pending={form.pending} variant="outline" pendingLabel="Verificando…">
        Verificar mi pago ahora
      </SubmitButton>
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
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

export function DiscardChangeButton() {
  return (
    <ConfirmButton
      variant="outline"
      action={discardPlanChangeAction}
      confirmMessage="¿Descartar el cambio de plan? Tu plan actual no se modifica."
    >
      Descartar el cambio
    </ConfirmButton>
  );
}
