"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";

export function ResendVerificationForm() {
  const [state, action] = useActionState(resendVerificationAction, undefined);

  return (
    <form action={action} className="space-y-3">
      <FormMessage message={state?.message} tone={state?.ok ? "success" : "error"} />
      {state?.devVerificationLink && (
        <p className="rounded-lg border border-dashed border-warning/50 bg-warning-soft px-3 py-2.5 text-sm text-warning">
          Modo desarrollo: el envío de emails no está configurado, así que el enlace se muestra acá.{" "}
          <Link href={state.devVerificationLink} prefetch={false} className="font-medium underline">
            Abrir enlace
          </Link>
        </p>
      )}
      <SubmitButton variant="outline" className="w-full" pendingLabel="Enviando…">
        Enviar el enlace de nuevo
      </SubmitButton>
    </form>
  );
}
