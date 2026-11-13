"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { firstError } from "@/lib/action-state";
import { startLicensePurchaseAction } from "@/modules/billing/license-actions";

export function LicenseOrderForm({ priceLabel, terms }: { priceLabel: string; terms: string }) {
  const [state, action] = useActionState(startLicensePurchaseAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <Field label="Tu nombre" htmlFor="name" error={firstError(state, "name")}>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Nombre de tu negocio" htmlFor="businessName" error={firstError(state, "businessName")}>
        <Input id="businessName" name="businessName" autoComplete="organization" required />
      </Field>
      <Field
        label="Email"
        htmlFor="email"
        error={firstError(state, "email")}
        hint="Ahí te escribimos para coordinar la instalación."
      >
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field label="Teléfono o WhatsApp" htmlFor="phone" optional error={firstError(state, "phone")}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" />
      </Field>

      <label className="flex items-start gap-2.5 rounded-xl bg-secondary p-3.5 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span>
          Leí y acepto las condiciones: es una licencia de uso, sin entrega del código fuente. {terms}
        </span>
      </label>

      <FormMessage message={state?.message} />
      <SubmitButton size="lg" className="w-full" pendingLabel="Conectando con Mercado Pago…">
        Pagar {priceLabel} con Mercado Pago
      </SubmitButton>
      <p className="text-center text-xs text-muted-foreground">
        El pago se hace en Mercado Pago. No guardamos los datos de tu tarjeta.
      </p>
    </form>
  );
}
