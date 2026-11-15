"use client";

import { ConfirmButton } from "@/components/form/confirm-button";
import { cancelSubscriptionAction, discardPlanChangeAction } from "@/modules/billing/actions";

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
